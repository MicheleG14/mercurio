-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "membership_role" AS ENUM ('ADMIN', 'WAREHOUSE_KEEPER', 'ACCOUNTANT', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "tenant_status" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "membership_role" NOT NULL,
    "status" "membership_status" NOT NULL DEFAULT 'ACTIVE',
    "all_companies" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_companies" (
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,

    CONSTRAINT "membership_companies_pkey" PRIMARY KEY ("membership_id","company_id")
);

-- CreateTable
CREATE TABLE "activation_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activation_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "tenant_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "legal_name" TEXT NOT NULL,
    "vat_number" TEXT NOT NULL,
    "tax_code" TEXT,
    "country" CHAR(2) NOT NULL DEFAULT 'IT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_modules" (
    "tenant_id" UUID NOT NULL,
    "module_key" TEXT NOT NULL,
    "enabled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_modules_pkey" PRIMARY KEY ("tenant_id","module_key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_tenant_id_user_id_key" ON "memberships"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_tenant_id_id_key" ON "memberships"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "activation_tokens_token_hash_key" ON "activation_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "companies_tenant_id_id_key" ON "companies"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "companies_tenant_id_vat_number_key" ON "companies"("tenant_id", "vat_number");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_companies" ADD CONSTRAINT "membership_companies_tenant_id_membership_id_fkey" FOREIGN KEY ("tenant_id", "membership_id") REFERENCES "memberships"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_companies" ADD CONSTRAINT "membership_companies_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activation_tokens" ADD CONSTRAINT "activation_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================================
-- Written by hand from here on: Prisma does not model checks, Row-Level Security or grants.
-- See docs/adr/0008 and docs/conventions.md B25, B26.
-- ===========================================================================================

-- Values the database enforces regardless of the code that writes them.
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_slug_format"
  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "users" ADD CONSTRAINT "users_email_normalized"
  CHECK (email = lower(btrim(email)) AND email <> '');
ALTER TABLE "companies" ADD CONSTRAINT "companies_country_format"
  CHECK (country ~ '^[A-Z]{2}$');
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_key_format"
  CHECK (module_key ~ '^[a-z]+$');

-- Context of the current transaction, set by the API with set_config(..., true) (local to the
-- transaction, so it never leaks to another request through the connection pool).
-- Unset or empty means NULL: every comparison is false and no row is visible.
CREATE FUNCTION app_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION app_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

-- The standard protection of a tenant table, used by every migration that creates one:
-- rows are visible and writable only inside the current tenant. FORCE applies the policy to
-- the table owner too; only a superuser (migrations, commands) can still bypass it.
CREATE FUNCTION mercurio_enable_tenant_isolation(target regclass) RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s '
    'USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())',
    target
  );
END
$$;
REVOKE EXECUTE ON FUNCTION mercurio_enable_tenant_isolation(regclass) FROM PUBLIC;

SELECT mercurio_enable_tenant_isolation('companies');
SELECT mercurio_enable_tenant_isolation('tenant_modules');
SELECT mercurio_enable_tenant_isolation('memberships');
SELECT mercurio_enable_tenant_isolation('membership_companies');

-- A user also sees their own active memberships in other tenants (to choose a tenant at
-- sign-in). Read only: writes stay limited to the current tenant by tenant_isolation.
CREATE POLICY own_memberships ON "memberships" FOR SELECT
  USING (user_id = app_user_id() AND status = 'ACTIVE');

-- Platform tables. tenants: the current tenant, and those where the current user is an
-- active member. users: the current user, and the members of the current tenant.
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
CREATE POLICY visible_tenants ON "tenants" FOR SELECT
  USING (
    id = app_tenant_id()
    OR EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.tenant_id = tenants.id AND m.user_id = app_user_id() AND m.status = 'ACTIVE'
    )
  );

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
CREATE POLICY visible_users ON "users" FOR SELECT
  USING (
    id = app_user_id()
    OR EXISTS (
      SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.tenant_id = app_tenant_id()
    )
  );

-- Activation codes: no policy and no grant, so the API role cannot read them at all.
-- Phase 1b adds a narrow, audited way to redeem them.
ALTER TABLE "activation_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activation_tokens" FORCE ROW LEVEL SECURITY;

-- The API role reads only, for now: no API feature writes yet. Write privileges are granted
-- table by table by the migration of the feature that needs them (B26).
GRANT SELECT ON "tenants", "users", "companies", "tenant_modules", "memberships",
  "membership_companies" TO mercurio_app;
