-- CreateEnum
CREATE TYPE "order_kind" AS ENUM ('PURCHASE', 'SALES');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('DRAFT', 'CONFIRMED', 'PARTIAL', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" "order_kind" NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'DRAFT',
    "series" TEXT,
    "year" INTEGER,
    "number" INTEGER,
    "order_date" DATE NOT NULL,
    "party_id" UUID NOT NULL,
    "warehouse_id" UUID,
    "party_reference" TEXT,
    "party_reference_date" DATE,
    "requested_date" DATE,
    "notes" TEXT,
    "taxable_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "confirmed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_price" DECIMAL(14,4),
    "discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "vat_code" TEXT NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL,
    "vat_nature" TEXT,
    "line_amount" DECIMAL(14,2),
    "done_quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "closed_quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_fulfilments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "stock_document_id" UUID NOT NULL,
    "fulfilment_date" DATE NOT NULL,
    "reversal_document_id" UUID,
    "reversed_at" TIMESTAMPTZ(6),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_fulfilments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_fulfilment_lines" (
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "fulfilment_id" UUID NOT NULL,
    "order_line_id" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "order_fulfilment_lines_pkey" PRIMARY KEY ("fulfilment_id","order_line_id")
);

-- CreateTable
CREATE TABLE "order_counters" (
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "series" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL,

    CONSTRAINT "order_counters_pkey" PRIMARY KEY ("company_id","series","year")
);

-- CreateIndex
CREATE INDEX "orders_tenant_id_company_id_kind_status_order_date_idx" ON "orders"("tenant_id", "company_id", "kind", "status", "order_date" DESC);

-- CreateIndex
CREATE INDEX "orders_tenant_id_party_id_idx" ON "orders"("tenant_id", "party_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenant_id_id_key" ON "orders"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenant_id_company_id_id_key" ON "orders"("tenant_id", "company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenant_id_company_id_series_year_number_key" ON "orders"("tenant_id", "company_id", "series", "year", "number");

-- CreateIndex
CREATE INDEX "order_lines_tenant_id_item_id_idx" ON "order_lines"("tenant_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_lines_tenant_id_id_key" ON "order_lines"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "order_lines_tenant_id_order_id_id_key" ON "order_lines"("tenant_id", "order_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "order_lines_order_id_line_no_key" ON "order_lines"("order_id", "line_no");

-- CreateIndex
CREATE INDEX "order_fulfilments_tenant_id_order_id_idx" ON "order_fulfilments"("tenant_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_fulfilments_tenant_id_id_key" ON "order_fulfilments"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "order_fulfilments_tenant_id_order_id_id_key" ON "order_fulfilments"("tenant_id", "order_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "order_fulfilments_tenant_id_company_id_stock_document_id_key" ON "order_fulfilments"("tenant_id", "company_id", "stock_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_fulfilments_tenant_id_company_id_reversal_document_id_key" ON "order_fulfilments"("tenant_id", "company_id", "reversal_document_id");

-- CreateIndex
CREATE INDEX "order_fulfilment_lines_tenant_id_order_line_id_idx" ON "order_fulfilment_lines"("tenant_id", "order_line_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_party_id_fkey" FOREIGN KEY ("tenant_id", "party_id") REFERENCES "parties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_company_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "warehouse_id") REFERENCES "warehouses"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_tenant_id_company_id_order_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "order_id") REFERENCES "orders"("tenant_id", "company_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_tenant_id_item_id_fkey" FOREIGN KEY ("tenant_id", "item_id") REFERENCES "items"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_fulfilments" ADD CONSTRAINT "order_fulfilments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_fulfilments" ADD CONSTRAINT "order_fulfilments_tenant_id_company_id_order_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "order_id") REFERENCES "orders"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_fulfilments" ADD CONSTRAINT "order_fulfilments_tenant_id_company_id_stock_document_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "stock_document_id") REFERENCES "stock_documents"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_fulfilments" ADD CONSTRAINT "order_fulfilments_tenant_id_company_id_reversal_document_i_fkey" FOREIGN KEY ("tenant_id", "company_id", "reversal_document_id") REFERENCES "stock_documents"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_fulfilments" ADD CONSTRAINT "order_fulfilments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_fulfilment_lines" ADD CONSTRAINT "order_fulfilment_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_fulfilment_lines" ADD CONSTRAINT "order_fulfilment_lines_tenant_id_order_id_fulfilment_id_fkey" FOREIGN KEY ("tenant_id", "order_id", "fulfilment_id") REFERENCES "order_fulfilments"("tenant_id", "order_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_fulfilment_lines" ADD CONSTRAINT "order_fulfilment_lines_tenant_id_order_id_order_line_id_fkey" FOREIGN KEY ("tenant_id", "order_id", "order_line_id") REFERENCES "order_lines"("tenant_id", "order_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_counters" ADD CONSTRAINT "order_counters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_counters" ADD CONSTRAINT "order_counters_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================================
-- Written by hand from here on: checks, Row-Level Security and grants. See docs/adr/0024 and
-- docs/conventions.md B11, B25, B26, B32, B36.
-- ===========================================================================================

-- Values the database enforces regardless of the code that writes them.
-- A draft has no number; anything else has one, in the series of its kind, and a warehouse.
ALTER TABLE "orders" ADD CONSTRAINT "orders_number_when_confirmed"
  CHECK (CASE WHEN status = 'DRAFT'
              THEN series IS NULL AND year IS NULL AND number IS NULL AND confirmed_at IS NULL
              ELSE series IS NOT NULL AND year IS NOT NULL AND number IS NOT NULL
                   AND confirmed_at IS NOT NULL AND warehouse_id IS NOT NULL END);
ALTER TABLE "orders" ADD CONSTRAINT "orders_series_of_kind"
  CHECK (series IS NULL OR (kind = 'PURCHASE' AND series = 'OF') OR (kind = 'SALES' AND series = 'OC'));
ALTER TABLE "orders" ADD CONSTRAINT "orders_number_positive"
  CHECK (number IS NULL OR (number >= 1 AND year BETWEEN 2000 AND 2999));
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancelled_at"
  CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL));
ALTER TABLE "orders" ADD CONSTRAINT "orders_requested_after_order"
  CHECK (requested_date IS NULL OR requested_date >= order_date);
ALTER TABLE "orders" ADD CONSTRAINT "orders_totals"
  CHECK (taxable_total >= 0 AND vat_total >= 0 AND total = taxable_total + vat_total);
ALTER TABLE "orders" ADD CONSTRAINT "orders_version_positive" CHECK (version >= 1);

-- A line: positive quantity, a price that is a price, a discount that is a percentage, and never
-- more moved or closed than ordered (B11 applied to orders).
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_line_positive" CHECK (line_no >= 1);
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_quantity_positive" CHECK (quantity > 0);
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_price_not_negative"
  CHECK (unit_price IS NULL OR unit_price >= 0);
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_discount_percentage"
  CHECK (discount_percent >= 0 AND discount_percent <= 100);
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_amount_with_price"
  CHECK ((unit_price IS NULL) = (line_amount IS NULL) AND (line_amount IS NULL OR line_amount >= 0));
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_vat_rate"
  CHECK (vat_rate >= 0 AND vat_rate < 100);
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_description_present"
  CHECK (btrim(description) <> '');
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_progress_within_quantity"
  CHECK (done_quantity >= 0 AND closed_quantity >= 0 AND done_quantity + closed_quantity <= quantity);

-- A fulfilment is undone once, by a document of its own; the undoing and its time go together.
ALTER TABLE "order_fulfilments" ADD CONSTRAINT "order_fulfilments_reversal"
  CHECK ((reversal_document_id IS NULL) = (reversed_at IS NULL)
     AND reversal_document_id IS DISTINCT FROM stock_document_id);
ALTER TABLE "order_fulfilment_lines" ADD CONSTRAINT "order_fulfilment_lines_quantity_positive"
  CHECK (quantity > 0);
ALTER TABLE "order_counters" ADD CONSTRAINT "order_counters_positive" CHECK (last_number >= 1);

SELECT mercurio_enable_tenant_isolation('orders');
SELECT mercurio_enable_tenant_isolation('order_lines');
SELECT mercurio_enable_tenant_isolation('order_fulfilments');
SELECT mercurio_enable_tenant_isolation('order_fulfilment_lines');
SELECT mercurio_enable_tenant_isolation('order_counters');

-- An order changes while a draft and in its status and progress after; it is deleted only as a
-- draft (enforced by the API: the database cannot tell a draft row from another for DELETE), and
-- its lines with it, or one by one when a draft is saved again. Kind, company and creator never
-- change. Fulfilments are append-only (B32), apart from being marked undone once; their lines are
-- append-only.
GRANT SELECT, INSERT ON "orders", "order_lines", "order_fulfilments", "order_fulfilment_lines",
  "order_counters" TO mercurio_app;
GRANT UPDATE (status, series, year, number, order_date, party_id, warehouse_id, party_reference,
  party_reference_date, requested_date, notes, taxable_total, vat_total, total, version,
  confirmed_at, cancelled_at, updated_at) ON "orders" TO mercurio_app;
GRANT DELETE ON "orders", "order_lines" TO mercurio_app;
GRANT UPDATE (done_quantity, closed_quantity, updated_at) ON "order_lines" TO mercurio_app;
GRANT UPDATE (reversal_document_id, reversed_at) ON "order_fulfilments" TO mercurio_app;
GRANT UPDATE (last_number) ON "order_counters" TO mercurio_app;
