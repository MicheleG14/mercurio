-- ===========================================================================================
-- Written by hand: more of the warehouse's read contract for other modules (docs/adr/0022, B3).
-- Orders show the code of their warehouse and find the lines not yet covered by a reservation in
-- their own queries; they join these views, never the tables behind them.
-- ===========================================================================================

CREATE VIEW "warehouse_refs" WITH (security_invoker = true) AS
  SELECT tenant_id, company_id, id, code, name, archived_at
  FROM "warehouses";

CREATE VIEW "warehouse_reservation_refs" WITH (security_invoker = true) AS
  SELECT tenant_id, company_id, warehouse_id, item_id, origin_type, origin_id, origin_line_id,
         quantity
  FROM "stock_reservations";

GRANT SELECT ON "warehouse_refs", "warehouse_reservation_refs" TO mercurio_app;
