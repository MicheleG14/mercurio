-- ===========================================================================================
-- Written by hand: an item's stock_managed is fixed at creation (docs/adr/0021). Since 0.7.0 the
-- API no longer writes it on update, so the privilege can go without breaking a rollback to
-- 0.7.0 (B13). Only the column grant is revoked; the others on "items" stay as they are.
-- ===========================================================================================

REVOKE UPDATE (stock_managed) ON "items" FROM mercurio_app;
