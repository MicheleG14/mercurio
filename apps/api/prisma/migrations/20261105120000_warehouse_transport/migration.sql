-- AlterTable
ALTER TABLE "stock_documents" ADD COLUMN     "transport" JSONB;

-- Written by hand: optional, so 0.7.0 keeps working (B13). Documents stay insert-only (B32): the
-- API role inserts the column with the document and never changes it.
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_transport_sales_only"
  CHECK (transport IS NULL OR reason = 'SALE_ISSUE');
