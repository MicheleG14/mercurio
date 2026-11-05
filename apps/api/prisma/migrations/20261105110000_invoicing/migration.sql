-- CreateEnum
CREATE TYPE "invoice_kind" AS ENUM ('INVOICE', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "payment_kind" AS ENUM ('RECEIPT', 'REFUND');

-- CreateTable
CREATE TABLE "invoiceable_fulfilments" (
    "fulfilment_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_reference" TEXT NOT NULL,
    "party_reference" TEXT,
    "party_reference_date" DATE,
    "document_id" UUID NOT NULL,
    "document_reference" TEXT NOT NULL,
    "document_date" DATE NOT NULL,
    "draft_id" UUID,
    "invoice_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoiceable_fulfilments_pkey" PRIMARY KEY ("fulfilment_id")
);

-- CreateTable
CREATE TABLE "invoiceable_lines" (
    "tenant_id" UUID NOT NULL,
    "fulfilment_id" UUID NOT NULL,
    "order_line_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_price" DECIMAL(14,4) NOT NULL,
    "discount_percent" DECIMAL(5,2) NOT NULL,
    "vat_code" TEXT NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL,
    "vat_nature" TEXT,

    CONSTRAINT "invoiceable_lines_pkey" PRIMARY KEY ("fulfilment_id","order_line_id")
);

-- CreateTable
CREATE TABLE "invoice_drafts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" "invoice_kind" NOT NULL,
    "party_id" UUID,
    "credited_invoice_id" UUID,
    "language" TEXT,
    "payment_terms" TEXT,
    "payment_method" TEXT,
    "notes" TEXT,
    "taxable_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoice_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_draft_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "draft_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID,
    "description" TEXT NOT NULL,
    "unit" TEXT,
    "quantity" DECIMAL(14,3),
    "unit_price" DECIMAL(14,4),
    "discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "vat_code" TEXT,
    "vat_rate" DECIMAL(5,2),
    "vat_nature" TEXT,
    "line_amount" DECIMAL(14,2),
    "fulfilment_id" UUID,
    "order_line_id" UUID,
    "credited_line_id" UUID,
    "stamp_duty_charge" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "invoice_draft_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" "invoice_kind" NOT NULL,
    "series" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "issue_date" DATE NOT NULL,
    "party_id" UUID NOT NULL,
    "credited_invoice_id" UUID,
    "seller" JSONB NOT NULL,
    "customer" JSONB NOT NULL,
    "language" TEXT NOT NULL,
    "payment_terms" TEXT NOT NULL,
    "payment_method" TEXT NOT NULL,
    "iban" TEXT,
    "notes" TEXT,
    "taxable_total" DECIMAL(14,2) NOT NULL,
    "vat_total" DECIMAL(14,2) NOT NULL,
    "stamp_duty" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "issued_by_id" UUID,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID,
    "description" TEXT NOT NULL,
    "unit" TEXT,
    "quantity" DECIMAL(14,3),
    "unit_price" DECIMAL(14,4),
    "discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "vat_code" TEXT,
    "vat_rate" DECIMAL(5,2),
    "vat_nature" TEXT,
    "line_amount" DECIMAL(14,2),
    "fulfilment_id" UUID,
    "order_line_id" UUID,
    "credited_line_id" UUID,
    "stamp_duty_charge" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_vat_rows" (
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "vat_code" TEXT NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL,
    "vat_nature" TEXT,
    "taxable" DECIMAL(14,2) NOT NULL,
    "vat" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "invoice_vat_rows_pkey" PRIMARY KEY ("invoice_id","vat_code")
);

-- CreateTable
CREATE TABLE "invoice_counters" (
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "series" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL,
    "last_date" DATE NOT NULL,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("company_id","series","year")
);

-- CreateTable
CREATE TABLE "invoice_due_dates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "settled_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoice_due_dates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" "payment_kind" NOT NULL,
    "party_id" UUID NOT NULL,
    "payment_date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "reverses_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "due_date_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("payment_id","due_date_id")
);

-- CreateTable
CREATE TABLE "credit_allocations" (
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "credit_note_id" UUID NOT NULL,
    "due_date_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "credit_allocations_pkey" PRIMARY KEY ("credit_note_id","due_date_id")
);

-- CreateIndex
CREATE INDEX "invoiceable_fulfilments_tenant_id_company_id_party_id_docum_idx" ON "invoiceable_fulfilments"("tenant_id", "company_id", "party_id", "document_date");

-- CreateIndex
CREATE UNIQUE INDEX "invoiceable_fulfilments_tenant_id_fulfilment_id_key" ON "invoiceable_fulfilments"("tenant_id", "fulfilment_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoiceable_fulfilments_tenant_id_company_id_fulfilment_id_key" ON "invoiceable_fulfilments"("tenant_id", "company_id", "fulfilment_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoiceable_lines_tenant_id_fulfilment_id_order_line_id_key" ON "invoiceable_lines"("tenant_id", "fulfilment_id", "order_line_id");

-- CreateIndex
CREATE INDEX "invoice_drafts_tenant_id_company_id_created_at_idx" ON "invoice_drafts"("tenant_id", "company_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_drafts_tenant_id_id_key" ON "invoice_drafts"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_drafts_tenant_id_company_id_id_key" ON "invoice_drafts"("tenant_id", "company_id", "id");

-- CreateIndex
CREATE INDEX "invoice_draft_lines_tenant_id_draft_id_idx" ON "invoice_draft_lines"("tenant_id", "draft_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_draft_lines_draft_id_line_no_key" ON "invoice_draft_lines"("draft_id", "line_no");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_company_id_issue_date_idx" ON "invoices"("tenant_id", "company_id", "issue_date" DESC);

-- CreateIndex
CREATE INDEX "invoices_tenant_id_party_id_idx" ON "invoices"("tenant_id", "party_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_id_key" ON "invoices"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_company_id_id_key" ON "invoices"("tenant_id", "company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_company_id_series_year_number_key" ON "invoices"("tenant_id", "company_id", "series", "year", "number");

-- CreateIndex
CREATE INDEX "invoice_lines_tenant_id_credited_line_id_idx" ON "invoice_lines"("tenant_id", "credited_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_tenant_id_company_id_id_key" ON "invoice_lines"("tenant_id", "company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_tenant_id_fulfilment_id_order_line_id_key" ON "invoice_lines"("tenant_id", "fulfilment_id", "order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_invoice_id_line_no_key" ON "invoice_lines"("invoice_id", "line_no");

-- CreateIndex
CREATE INDEX "invoice_due_dates_tenant_id_company_id_due_date_idx" ON "invoice_due_dates"("tenant_id", "company_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_due_dates_tenant_id_company_id_id_key" ON "invoice_due_dates"("tenant_id", "company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_due_dates_invoice_id_seq_key" ON "invoice_due_dates"("invoice_id", "seq");

-- CreateIndex
CREATE INDEX "payments_tenant_id_company_id_payment_date_idx" ON "payments"("tenant_id", "company_id", "payment_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_company_id_id_key" ON "payments"("tenant_id", "company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_company_id_reverses_id_key" ON "payments"("tenant_id", "company_id", "reverses_id");

-- CreateIndex
CREATE INDEX "payment_allocations_tenant_id_due_date_id_idx" ON "payment_allocations"("tenant_id", "due_date_id");

-- CreateIndex
CREATE INDEX "credit_allocations_tenant_id_due_date_id_idx" ON "credit_allocations"("tenant_id", "due_date_id");

-- AddForeignKey
ALTER TABLE "invoiceable_fulfilments" ADD CONSTRAINT "invoiceable_fulfilments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoiceable_fulfilments" ADD CONSTRAINT "invoiceable_fulfilments_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoiceable_fulfilments" ADD CONSTRAINT "invoiceable_fulfilments_tenant_id_party_id_fkey" FOREIGN KEY ("tenant_id", "party_id") REFERENCES "parties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoiceable_fulfilments" ADD CONSTRAINT "invoiceable_fulfilments_tenant_id_company_id_draft_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "draft_id") REFERENCES "invoice_drafts"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoiceable_fulfilments" ADD CONSTRAINT "invoiceable_fulfilments_tenant_id_company_id_invoice_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "invoice_id") REFERENCES "invoices"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoiceable_lines" ADD CONSTRAINT "invoiceable_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoiceable_lines" ADD CONSTRAINT "invoiceable_lines_tenant_id_fulfilment_id_fkey" FOREIGN KEY ("tenant_id", "fulfilment_id") REFERENCES "invoiceable_fulfilments"("tenant_id", "fulfilment_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoiceable_lines" ADD CONSTRAINT "invoiceable_lines_tenant_id_item_id_fkey" FOREIGN KEY ("tenant_id", "item_id") REFERENCES "items"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_drafts" ADD CONSTRAINT "invoice_drafts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_drafts" ADD CONSTRAINT "invoice_drafts_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_drafts" ADD CONSTRAINT "invoice_drafts_tenant_id_party_id_fkey" FOREIGN KEY ("tenant_id", "party_id") REFERENCES "parties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_drafts" ADD CONSTRAINT "invoice_drafts_tenant_id_company_id_credited_invoice_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "credited_invoice_id") REFERENCES "invoices"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_drafts" ADD CONSTRAINT "invoice_drafts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_draft_lines" ADD CONSTRAINT "invoice_draft_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_draft_lines" ADD CONSTRAINT "invoice_draft_lines_tenant_id_company_id_draft_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "draft_id") REFERENCES "invoice_drafts"("tenant_id", "company_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_draft_lines" ADD CONSTRAINT "invoice_draft_lines_tenant_id_item_id_fkey" FOREIGN KEY ("tenant_id", "item_id") REFERENCES "items"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_draft_lines" ADD CONSTRAINT "invoice_draft_lines_tenant_id_fulfilment_id_order_line_id_fkey" FOREIGN KEY ("tenant_id", "fulfilment_id", "order_line_id") REFERENCES "invoiceable_lines"("tenant_id", "fulfilment_id", "order_line_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_draft_lines" ADD CONSTRAINT "invoice_draft_lines_tenant_id_company_id_credited_line_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "credited_line_id") REFERENCES "invoice_lines"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_party_id_fkey" FOREIGN KEY ("tenant_id", "party_id") REFERENCES "parties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_company_id_credited_invoice_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "credited_invoice_id") REFERENCES "invoices"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_id_company_id_invoice_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "invoice_id") REFERENCES "invoices"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_id_item_id_fkey" FOREIGN KEY ("tenant_id", "item_id") REFERENCES "items"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_id_fulfilment_id_order_line_id_fkey" FOREIGN KEY ("tenant_id", "fulfilment_id", "order_line_id") REFERENCES "invoiceable_lines"("tenant_id", "fulfilment_id", "order_line_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_id_company_id_credited_line_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "credited_line_id") REFERENCES "invoice_lines"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_vat_rows" ADD CONSTRAINT "invoice_vat_rows_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_vat_rows" ADD CONSTRAINT "invoice_vat_rows_tenant_id_company_id_invoice_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "invoice_id") REFERENCES "invoices"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_counters" ADD CONSTRAINT "invoice_counters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_counters" ADD CONSTRAINT "invoice_counters_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_due_dates" ADD CONSTRAINT "invoice_due_dates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_due_dates" ADD CONSTRAINT "invoice_due_dates_tenant_id_company_id_invoice_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "invoice_id") REFERENCES "invoices"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_party_id_fkey" FOREIGN KEY ("tenant_id", "party_id") REFERENCES "parties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_company_id_reverses_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "reverses_id") REFERENCES "payments"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenant_id_company_id_payment_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "payment_id") REFERENCES "payments"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenant_id_company_id_due_date_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "due_date_id") REFERENCES "invoice_due_dates"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_allocations" ADD CONSTRAINT "credit_allocations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_allocations" ADD CONSTRAINT "credit_allocations_tenant_id_company_id_credit_note_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "credit_note_id") REFERENCES "invoices"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_allocations" ADD CONSTRAINT "credit_allocations_tenant_id_company_id_due_date_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "due_date_id") REFERENCES "invoice_due_dates"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================================
-- Written by hand from here on: checks, Row-Level Security and grants. See docs/adr/0027-0030
-- and docs/conventions.md B11, B25, B26, B32, B36, B37, B38.
-- ===========================================================================================

-- An issued document: the series of its kind, a number in the year of its date, a credit note
-- always about an invoice, totals that add up (the stamp duty is the seller's, or a line).
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_series_of_kind"
  CHECK ((kind = 'INVOICE' AND series = 'FT') OR (kind = 'CREDIT_NOTE' AND series = 'NC'));
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_number_in_year"
  CHECK (number >= 1 AND year = EXTRACT(YEAR FROM issue_date));
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_credit_note_credits"
  CHECK ((kind = 'CREDIT_NOTE') = (credited_invoice_id IS NOT NULL) AND credited_invoice_id IS DISTINCT FROM id);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_totals"
  CHECK (taxable_total >= 0 AND vat_total >= 0 AND total = taxable_total + vat_total AND total > 0
     AND stamp_duty IN (0, 2));
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_language" CHECK (language IN ('it', 'en'));

-- A line has a quantity, a price, VAT and an amount, or none of them (a description only); a
-- line of a shipment names both the shipment and the order line.
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_line_positive" CHECK (line_no >= 1);
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_description_present"
  CHECK (btrim(description) <> '');
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_priced_or_descriptive"
  CHECK ((quantity IS NULL) = (unit_price IS NULL) AND (unit_price IS NULL) = (line_amount IS NULL)
     AND (line_amount IS NULL) = (vat_code IS NULL) AND (vat_code IS NULL) = (vat_rate IS NULL));
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_values"
  CHECK ((quantity IS NULL OR quantity > 0) AND (unit_price IS NULL OR unit_price >= 0)
     AND discount_percent >= 0 AND discount_percent <= 100
     AND (line_amount IS NULL OR line_amount >= 0) AND (vat_rate IS NULL OR (vat_rate >= 0 AND vat_rate < 100)));
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_shipment"
  CHECK ((fulfilment_id IS NULL) = (order_line_id IS NULL));
ALTER TABLE "invoice_vat_rows" ADD CONSTRAINT "invoice_vat_rows_values"
  CHECK (taxable >= 0 AND vat >= 0 AND vat_rate >= 0 AND vat_rate < 100);

-- A draft: the same lines, but a price may still be missing while it is typed.
ALTER TABLE "invoice_drafts" ADD CONSTRAINT "invoice_drafts_totals"
  CHECK (taxable_total >= 0 AND vat_total >= 0 AND total = taxable_total + vat_total);
ALTER TABLE "invoice_drafts" ADD CONSTRAINT "invoice_drafts_version_positive" CHECK (version >= 1);
ALTER TABLE "invoice_drafts" ADD CONSTRAINT "invoice_drafts_language"
  CHECK (language IS NULL OR language IN ('it', 'en'));
ALTER TABLE "invoice_drafts" ADD CONSTRAINT "invoice_drafts_credited_invoice"
  CHECK ((kind = 'CREDIT_NOTE') = (credited_invoice_id IS NOT NULL));
ALTER TABLE "invoice_draft_lines" ADD CONSTRAINT "invoice_draft_lines_line_positive" CHECK (line_no >= 1);
ALTER TABLE "invoice_draft_lines" ADD CONSTRAINT "invoice_draft_lines_description_present"
  CHECK (btrim(description) <> '');
ALTER TABLE "invoice_draft_lines" ADD CONSTRAINT "invoice_draft_lines_priced_or_descriptive"
  CHECK ((quantity IS NULL) = (vat_code IS NULL) AND (vat_code IS NULL) = (vat_rate IS NULL)
     AND (unit_price IS NULL) = (line_amount IS NULL) AND (quantity IS NOT NULL OR unit_price IS NULL));
ALTER TABLE "invoice_draft_lines" ADD CONSTRAINT "invoice_draft_lines_values"
  CHECK ((quantity IS NULL OR quantity > 0) AND (unit_price IS NULL OR unit_price >= 0)
     AND discount_percent >= 0 AND discount_percent <= 100
     AND (line_amount IS NULL OR line_amount >= 0) AND (vat_rate IS NULL OR (vat_rate >= 0 AND vat_rate < 100)));
ALTER TABLE "invoice_draft_lines" ADD CONSTRAINT "invoice_draft_lines_shipment"
  CHECK ((fulfilment_id IS NULL) = (order_line_id IS NULL));

-- What the orders module published: real quantities, prices and percentages.
ALTER TABLE "invoiceable_lines" ADD CONSTRAINT "invoiceable_lines_values"
  CHECK (quantity > 0 AND unit_price >= 0 AND discount_percent >= 0 AND discount_percent <= 100
     AND vat_rate >= 0 AND vat_rate < 100);

ALTER TABLE "invoice_counters" ADD CONSTRAINT "invoice_counters_positive" CHECK (last_number >= 1);

-- A due date is never settled beyond its amount, nor below zero (B11 applied to invoices).
ALTER TABLE "invoice_due_dates" ADD CONSTRAINT "invoice_due_dates_settled_within_amount"
  CHECK (seq >= 1 AND amount > 0 AND settled_amount >= 0 AND settled_amount <= amount);
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK (amount > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_reversal" CHECK (reverses_id IS DISTINCT FROM id);
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_amount" CHECK (amount <> 0);
ALTER TABLE "credit_allocations" ADD CONSTRAINT "credit_allocations_amount" CHECK (amount > 0);

SELECT mercurio_enable_tenant_isolation('invoiceable_fulfilments');
SELECT mercurio_enable_tenant_isolation('invoiceable_lines');
SELECT mercurio_enable_tenant_isolation('invoice_drafts');
SELECT mercurio_enable_tenant_isolation('invoice_draft_lines');
SELECT mercurio_enable_tenant_isolation('invoices');
SELECT mercurio_enable_tenant_isolation('invoice_lines');
SELECT mercurio_enable_tenant_isolation('invoice_vat_rows');
SELECT mercurio_enable_tenant_isolation('invoice_counters');
SELECT mercurio_enable_tenant_isolation('invoice_due_dates');
SELECT mercurio_enable_tenant_isolation('payments');
SELECT mercurio_enable_tenant_isolation('payment_allocations');
SELECT mercurio_enable_tenant_isolation('credit_allocations');

-- Issued documents, their lines and VAT summaries are insert-only (B37): no UPDATE, no DELETE,
-- so an issued invoice cannot change, whatever the code does. Payments and allocations are
-- append-only too (B32): a payment is undone by another that reverses it.
GRANT SELECT, INSERT ON "invoices", "invoice_lines", "invoice_vat_rows", "payments",
  "payment_allocations", "credit_allocations" TO mercurio_app;

-- Drafts are free to change and to delete, with their lines (replaced at every save). The kind,
-- the company and the creator of a draft never change.
GRANT SELECT, INSERT, DELETE ON "invoice_drafts", "invoice_draft_lines" TO mercurio_app;
GRANT UPDATE (party_id, credited_invoice_id, language, payment_terms, payment_method, notes,
  taxable_total, vat_total, total, version, updated_at) ON "invoice_drafts" TO mercurio_app;

-- Shipments to invoice: written by the listener, taken by a draft, invoiced once; deleted only
-- when the shipment is undone before any draft took it.
GRANT SELECT, INSERT, DELETE ON "invoiceable_fulfilments", "invoiceable_lines" TO mercurio_app;
GRANT UPDATE (draft_id, invoice_id) ON "invoiceable_fulfilments" TO mercurio_app;

-- What changes after issue is kept apart: how much of a due date is settled, and the counters.
GRANT SELECT, INSERT ON "invoice_due_dates", "invoice_counters" TO mercurio_app;
GRANT UPDATE (settled_amount, updated_at) ON "invoice_due_dates" TO mercurio_app;
GRANT UPDATE (last_number, last_date) ON "invoice_counters" TO mercurio_app;
