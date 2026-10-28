-- AlterTable
ALTER TABLE "stock_balances" ADD COLUMN     "reserved_quantity" DECIMAL(14,3) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "stock_documents" ADD COLUMN     "origin_id" UUID,
ADD COLUMN     "origin_reference" TEXT,
ADD COLUMN     "origin_type" TEXT;

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "origin_type" TEXT NOT NULL,
    "origin_id" UUID NOT NULL,
    "origin_line_id" UUID NOT NULL,
    "origin_reference" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_reservations_tenant_id_warehouse_id_item_id_idx" ON "stock_reservations"("tenant_id", "warehouse_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_reservations_tenant_id_origin_type_origin_line_id_key" ON "stock_reservations"("tenant_id", "origin_type", "origin_line_id");

-- CreateIndex
CREATE INDEX "stock_documents_tenant_id_origin_type_origin_id_idx" ON "stock_documents"("tenant_id", "origin_type", "origin_id");

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_tenant_id_company_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "warehouse_id") REFERENCES "warehouses"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_tenant_id_item_id_fkey" FOREIGN KEY ("tenant_id", "item_id") REFERENCES "items"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_warehouse_id_item_id_fkey" FOREIGN KEY ("warehouse_id", "item_id") REFERENCES "stock_balances"("warehouse_id", "item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================================
-- Written by hand from here on: checks, Row-Level Security, grants and the published view.
-- See docs/adr/0024, docs/adr/0025 and docs/conventions.md B11, B25, B26, B35.
-- ===========================================================================================

-- The safety belt of reservations (B11): whatever the code does, goods are never promised twice
-- and promised goods never leave. A database of 0.6.x refuses then what that version would let
-- out: the message degrades on a rollback, the data does not.
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_reserved_within_stock"
  CHECK (reserved_quantity >= 0 AND reserved_quantity <= quantity);
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_quantity_positive"
  CHECK (quantity > 0);
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_origin_present"
  CHECK (btrim(origin_type) <> '' AND btrim(origin_reference) <> '');
-- An origin is all there or not at all. The reversal of such a document carries the same one.
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_origin_complete"
  CHECK ((origin_type IS NULL) = (origin_id IS NULL)
     AND (origin_type IS NULL) = (origin_reference IS NULL));

SELECT mercurio_enable_tenant_isolation('stock_reservations');

-- A reservation changes in quantity and is deleted when it reaches zero. Balances now also
-- change in what is reserved.
GRANT SELECT, INSERT, DELETE ON "stock_reservations" TO mercurio_app;
GRANT UPDATE (quantity, updated_at) ON "stock_reservations" TO mercurio_app;
GRANT UPDATE (reserved_quantity) ON "stock_balances" TO mercurio_app;

-- The read contract of the warehouse for other modules (docs/adr/0022, B3): stock per warehouse
-- and item, with what is reserved and what is available. Orders join it in their lists.
CREATE VIEW "warehouse_stock_refs" WITH (security_invoker = true) AS
  SELECT tenant_id, company_id, warehouse_id, item_id, quantity, reserved_quantity,
         quantity - reserved_quantity AS available_quantity
  FROM "stock_balances";

GRANT SELECT ON "warehouse_stock_refs" TO mercurio_app;
