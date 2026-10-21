-- Trigram search ("contains", ILIKE '%text%') with an index, for the GIN indexes below. Written
-- by hand: Prisma does not model extensions. Trusted extension, created by the owner role.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "party_kind" AS ENUM ('PRIVATE', 'SOLE_TRADER', 'COMPANY', 'ORGANIZATION');

-- CreateTable
CREATE TABLE "parties" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" "party_kind" NOT NULL,
    "legal_form" TEXT,
    "is_customer" BOOLEAN NOT NULL,
    "is_supplier" BOOLEAN NOT NULL,
    "name" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "vat_number" TEXT,
    "tax_code" TEXT,
    "country" CHAR(2) NOT NULL DEFAULT 'IT',
    "address" TEXT,
    "postal_code" TEXT,
    "city" TEXT,
    "province" CHAR(2),
    "email" TEXT,
    "phone" TEXT,
    "pec_email" TEXT,
    "sdi_code" CHAR(7),
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "vat_code" TEXT NOT NULL,
    "sale_price" DECIMAL(14,4),
    "stock_managed" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parties_name_trgm_idx" ON "parties" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "parties_vat_number_trgm_idx" ON "parties" USING GIN ("vat_number" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "parties_tax_code_trgm_idx" ON "parties" USING GIN ("tax_code" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "parties_city_trgm_idx" ON "parties" USING GIN ("city" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "parties_tenant_id_id_key" ON "parties"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "items_code_trgm_idx" ON "items" USING GIN ("code" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "items_description_trgm_idx" ON "items" USING GIN ("description" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "items_tenant_id_id_key" ON "items"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "parties" ADD CONSTRAINT "parties_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================================
-- Written by hand from here on: checks, the two unique indexes Prisma cannot express, Row-Level
-- Security and grants. See docs/adr/0018 and docs/conventions.md B25, B26, B29, B31.
-- ===========================================================================================

-- Values the database enforces regardless of the code that writes them. The Italian rules
-- (check digits, which fields each kind needs) stay in code, where they are tested.
ALTER TABLE "parties" ADD CONSTRAINT "parties_has_role" CHECK (is_customer OR is_supplier);
ALTER TABLE "parties" ADD CONSTRAINT "parties_name_present" CHECK (btrim(name) <> '');
ALTER TABLE "parties" ADD CONSTRAINT "parties_country_format" CHECK (country ~ '^[A-Z]{2}$');
ALTER TABLE "parties" ADD CONSTRAINT "parties_version_positive" CHECK (version >= 1);
ALTER TABLE "items" ADD CONSTRAINT "items_code_format" CHECK (code ~ '^[A-Za-z0-9._/-]{1,35}$');
ALTER TABLE "items" ADD CONSTRAINT "items_description_length"
  CHECK (char_length(description) BETWEEN 1 AND 1000);
ALTER TABLE "items" ADD CONSTRAINT "items_sale_price_not_negative" CHECK (sale_price >= 0);
ALTER TABLE "items" ADD CONSTRAINT "items_version_positive" CHECK (version >= 1);

-- One active party per VAT number in a tenant: an archived one does not block a new entry.
-- Different tenants may of course have the same number.
CREATE UNIQUE INDEX "parties_tenant_id_vat_number_active_key" ON "parties" ("tenant_id", "vat_number")
  WHERE archived_at IS NULL AND vat_number IS NOT NULL;

-- An item code is never reused, archived items included, whatever the case: documents print it.
CREATE UNIQUE INDEX "items_tenant_id_code_key" ON "items" ("tenant_id", lower(code));

SELECT mercurio_enable_tenant_isolation('parties');
SELECT mercurio_enable_tenant_isolation('items');

-- No DELETE (B31: archived, never deleted). Updates are granted per column: never the id or the
-- tenant, and never an item's code, which stays what documents printed.
GRANT SELECT, INSERT ON "parties", "items" TO mercurio_app;
GRANT UPDATE (kind, legal_form, is_customer, is_supplier, name, first_name, last_name, vat_number,
  tax_code, country, address, postal_code, city, province, email, phone, pec_email, sdi_code, notes,
  version, archived_at, updated_at) ON "parties" TO mercurio_app;
GRANT UPDATE (description, unit, vat_code, sale_price, stock_managed, notes, version, archived_at,
  updated_at) ON "items" TO mercurio_app;
