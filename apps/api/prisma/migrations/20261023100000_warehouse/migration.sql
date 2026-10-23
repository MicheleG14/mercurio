-- CreateEnum
CREATE TYPE "stock_reason" AS ENUM ('OPENING', 'PURCHASE_RECEIPT', 'CUSTOMER_RETURN', 'SALE_ISSUE', 'INTERNAL_USE', 'LOSS', 'INVENTORY_ADJUSTMENT', 'TRANSFER', 'REVERSAL');

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "reason" "stock_reason" NOT NULL,
    "series" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "document_date" DATE NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "target_warehouse_id" UUID,
    "party_id" UUID,
    "party_document_ref" TEXT,
    "party_document_date" DATE,
    "reverses_id" UUID,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "counted_quantity" DECIMAL(14,3),
    "movement_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("warehouse_id","item_id")
);

-- CreateTable
CREATE TABLE "reorder_levels" (
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "reorder_point" DECIMAL(14,3) NOT NULL,
    "reorder_quantity" DECIMAL(14,3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reorder_levels_pkey" PRIMARY KEY ("warehouse_id","item_id")
);

-- CreateTable
CREATE TABLE "stock_document_counters" (
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "series" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL,

    CONSTRAINT "stock_document_counters_pkey" PRIMARY KEY ("company_id","series","year")
);

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_tenant_id_id_key" ON "warehouses"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_tenant_id_company_id_id_key" ON "warehouses"("tenant_id", "company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_tenant_id_company_id_code_key" ON "warehouses"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "stock_documents_tenant_id_company_id_document_date_idx" ON "stock_documents"("tenant_id", "company_id", "document_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "stock_documents_tenant_id_id_key" ON "stock_documents"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_documents_tenant_id_company_id_id_key" ON "stock_documents"("tenant_id", "company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_documents_tenant_id_company_id_series_year_number_key" ON "stock_documents"("tenant_id", "company_id", "series", "year", "number");

-- CreateIndex
CREATE UNIQUE INDEX "stock_documents_tenant_id_company_id_reverses_id_key" ON "stock_documents"("tenant_id", "company_id", "reverses_id");

-- CreateIndex
CREATE INDEX "stock_movements_tenant_id_warehouse_id_item_id_movement_dat_idx" ON "stock_movements"("tenant_id", "warehouse_id", "item_id", "movement_date");

-- CreateIndex
CREATE INDEX "stock_movements_tenant_id_item_id_movement_date_idx" ON "stock_movements"("tenant_id", "item_id", "movement_date");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_document_id_line_no_warehouse_id_key" ON "stock_movements"("document_id", "line_no", "warehouse_id");

-- CreateIndex
CREATE INDEX "stock_balances_tenant_id_item_id_idx" ON "stock_balances"("tenant_id", "item_id");

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_tenant_id_company_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "warehouse_id") REFERENCES "warehouses"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_tenant_id_company_id_target_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "target_warehouse_id") REFERENCES "warehouses"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_tenant_id_party_id_fkey" FOREIGN KEY ("tenant_id", "party_id") REFERENCES "parties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_tenant_id_company_id_reverses_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "reverses_id") REFERENCES "stock_documents"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_company_id_document_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "document_id") REFERENCES "stock_documents"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_company_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "warehouse_id") REFERENCES "warehouses"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_item_id_fkey" FOREIGN KEY ("tenant_id", "item_id") REFERENCES "items"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_tenant_id_company_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "warehouse_id") REFERENCES "warehouses"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_tenant_id_item_id_fkey" FOREIGN KEY ("tenant_id", "item_id") REFERENCES "items"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reorder_levels" ADD CONSTRAINT "reorder_levels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reorder_levels" ADD CONSTRAINT "reorder_levels_tenant_id_company_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "warehouse_id") REFERENCES "warehouses"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reorder_levels" ADD CONSTRAINT "reorder_levels_tenant_id_item_id_fkey" FOREIGN KEY ("tenant_id", "item_id") REFERENCES "items"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_document_counters" ADD CONSTRAINT "stock_document_counters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_document_counters" ADD CONSTRAINT "stock_document_counters_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================================
-- Written by hand from here on: checks, Row-Level Security and grants. See docs/adr/0021 and
-- docs/conventions.md B11, B25, B26, B32.
-- ===========================================================================================

-- Values the database enforces regardless of the code that writes them.
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_code_format" CHECK (code ~ '^[A-Z0-9-]{1,10}$');
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_name_present" CHECK (btrim(name) <> '');
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_version_positive" CHECK (version >= 1);

ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_series_known"
  CHECK (series IN ('CA', 'SC', 'RE', 'TR'));
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_number_positive"
  CHECK (number >= 1 AND year BETWEEN 2000 AND 2999);
-- A transfer always has a destination, different from its origin; only transfers (and their
-- reversals) have one. Only a reversal points to another document.
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_transfer_target"
  CHECK ((reason <> 'TRANSFER' OR target_warehouse_id IS NOT NULL)
     AND (target_warehouse_id IS NULL OR reason IN ('TRANSFER', 'REVERSAL'))
     AND (target_warehouse_id IS DISTINCT FROM warehouse_id));
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_reversal_link"
  CHECK ((reason = 'REVERSAL') = (reverses_id IS NOT NULL) AND reverses_id IS DISTINCT FROM id);

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_not_zero" CHECK (quantity <> 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_line_positive" CHECK (line_no >= 1);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_counted_not_negative"
  CHECK (counted_quantity >= 0);

-- The safety belt of B11: whatever the code does, stock never goes below zero.
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_not_negative" CHECK (quantity >= 0);

ALTER TABLE "reorder_levels" ADD CONSTRAINT "reorder_levels_point_not_negative"
  CHECK (reorder_point >= 0);
ALTER TABLE "reorder_levels" ADD CONSTRAINT "reorder_levels_quantity_positive"
  CHECK (reorder_quantity > 0);
ALTER TABLE "reorder_levels" ADD CONSTRAINT "reorder_levels_version_positive" CHECK (version >= 1);

ALTER TABLE "stock_document_counters" ADD CONSTRAINT "stock_document_counters_positive"
  CHECK (last_number >= 1);

SELECT mercurio_enable_tenant_isolation('warehouses');
SELECT mercurio_enable_tenant_isolation('stock_documents');
SELECT mercurio_enable_tenant_isolation('stock_movements');
SELECT mercurio_enable_tenant_isolation('stock_balances');
SELECT mercurio_enable_tenant_isolation('reorder_levels');
SELECT mercurio_enable_tenant_isolation('stock_document_counters');

-- Documents and movements are append-only (B32): no UPDATE, no DELETE. Warehouses are archived,
-- never deleted (B31), and their code never changes. Balances change only in quantity (and the
-- API locks them with SELECT ... FOR UPDATE, which needs an UPDATE privilege). A reorder level is
-- a setting: it can be removed.
GRANT SELECT, INSERT ON "warehouses", "stock_documents", "stock_movements", "stock_balances",
  "reorder_levels", "stock_document_counters" TO mercurio_app;
GRANT UPDATE (name, version, archived_at, updated_at) ON "warehouses" TO mercurio_app;
GRANT UPDATE (quantity, updated_at) ON "stock_balances" TO mercurio_app;
GRANT UPDATE (reorder_point, reorder_quantity, version, updated_at) ON "reorder_levels" TO mercurio_app;
GRANT DELETE ON "reorder_levels" TO mercurio_app;
GRANT UPDATE (last_number) ON "stock_document_counters" TO mercurio_app;
