-- The role the API runs as (docs/conventions.md B26). Migrations, terminal commands and seeds
-- use the owner role instead. mercurio_app has no special attribute: it cannot bypass
-- Row-Level Security, create roles or databases. It cannot log in until
-- scripts/provision-app-role.mjs sets its password, which never appears in a migration.
-- Privileges on tables are granted by the migrations that create them, only where needed.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mercurio_app') THEN
    CREATE ROLE mercurio_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO mercurio_app;
