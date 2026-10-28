-- ===========================================================================================
-- Written by hand: the item view gains the list price and the VAT code, which an order line
-- proposes (docs/adr/0022). Columns are only added at the end, so CREATE OR REPLACE keeps every
-- query of the previous version working (B13).
-- ===========================================================================================

CREATE OR REPLACE VIEW "registry_item_refs" WITH (security_invoker = true) AS
  SELECT tenant_id, id, code, description, unit, stock_managed, archived_at, sale_price, vat_code
  FROM "items";
