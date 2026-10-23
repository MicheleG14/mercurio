-- ===========================================================================================
-- Written by hand: the read contract of the registry for other modules (docs/adr/0022,
-- docs/conventions.md B3). Other modules may join these views, never the tables behind them, so
-- the registry can change its tables as long as the views keep their columns.
-- security_invoker: the view runs with the privileges and Row-Level Security of whoever queries
-- it, so a tenant still sees only its own rows through it.
-- ===========================================================================================

CREATE VIEW "registry_item_refs" WITH (security_invoker = true) AS
  SELECT tenant_id, id, code, description, unit, stock_managed, archived_at
  FROM "items";

CREATE VIEW "registry_party_refs" WITH (security_invoker = true) AS
  SELECT tenant_id, id, name, vat_number, is_customer, is_supplier, archived_at
  FROM "parties";

GRANT SELECT ON "registry_item_refs", "registry_party_refs" TO mercurio_app;
