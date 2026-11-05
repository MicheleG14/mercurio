-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "address" TEXT,
ADD COLUMN     "charge_stamp_duty" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "iban" TEXT,
ADD COLUMN     "in_liquidation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pec_email" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "postal_code" TEXT,
ADD COLUMN     "province" CHAR(2),
ADD COLUMN     "rea_number" TEXT,
ADD COLUMN     "rea_office" CHAR(2),
ADD COLUMN     "share_capital" DECIMAL(14,2),
ADD COLUMN     "sole_shareholder" BOOLEAN,
ADD COLUMN     "tax_regime" TEXT NOT NULL DEFAULT 'RF01',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "parties" ADD COLUMN     "document_language" TEXT,
ADD COLUMN     "payment_method" TEXT,
ADD COLUMN     "payment_terms" TEXT;

-- ===========================================================================================
-- Written by hand. Every column is optional or has a default (B13): 0.7.0 keeps working. What an
-- invoice needs from the company is checked when it is issued, not here.
-- The API may now change a company's header data, never its identity: not the legal name, the
-- VAT number, the tax code or the country, which only the operator sets from the terminal.
-- ===========================================================================================

GRANT UPDATE (address, postal_code, city, province, rea_office, rea_number, share_capital,
  sole_shareholder, in_liquidation, tax_regime, iban, email, pec_email, phone, charge_stamp_duty,
  version, updated_at) ON "companies" TO mercurio_app;

GRANT UPDATE (payment_terms, payment_method, document_language) ON "parties" TO mercurio_app;
