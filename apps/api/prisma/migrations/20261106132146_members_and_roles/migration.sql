-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "custom_role_id" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "role" DROP NOT NULL;

-- CreateTable
CREATE TABLE "tenant_roles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[],
    "based_on" "membership_role",
    "version" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_roles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_roles_tenant_id_id_key" ON "tenant_roles"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_custom_role_id_fkey" FOREIGN KEY ("tenant_id", "custom_role_id") REFERENCES "tenant_roles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_roles" ADD CONSTRAINT "tenant_roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================================
-- Written by hand (phase 7). Everything above is compatible with 1.0.x (B13): the new columns
-- are empty or have a default, and role stays filled until a custom role is assigned.
-- ===========================================================================================

-- A membership has a built-in role or a custom one: exactly one of the two.
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_one_role"
  CHECK ((role IS NULL) <> (custom_role_id IS NULL));

-- Custom roles: at least one permission, only from the assignable catalog. members:manage and
-- roles:manage are left out on purpose: they belong to the built-in ADMIN role only, or whoever
-- manages people could give themselves everything. The list is checked against the code by a test.
ALTER TABLE "tenant_roles" ALTER COLUMN "permissions" SET NOT NULL;
ALTER TABLE "tenant_roles" ADD CONSTRAINT "tenant_roles_permissions"
  CHECK (
    cardinality(permissions) > 0
    AND permissions <@ ARRAY[
      'parties:read', 'parties:write', 'items:read', 'items:write',
      'stock:read', 'stock:write', 'warehouses:manage',
      'orders:read', 'orders:write', 'orders:fulfil',
      'invoicing:read', 'invoicing:write', 'invoicing:issue', 'payments:write',
      'companies:manage', 'members:read', 'audit:read'
    ]::text[]
  );
ALTER TABLE "tenant_roles" ADD CONSTRAINT "tenant_roles_name" CHECK (btrim(name) <> '');
-- One name per tenant among the roles in use, whatever the case.
CREATE UNIQUE INDEX "tenant_roles_active_name" ON "tenant_roles" (tenant_id, lower(name))
  WHERE archived_at IS NULL;

SELECT mercurio_enable_tenant_isolation('tenant_roles');
-- A person sees the custom roles they hold in other tenants too, to show them when choosing a
-- tenant. Read only, and only those roles.
CREATE POLICY own_roles ON "tenant_roles" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.custom_role_id = tenant_roles.id AND m.user_id = app_user_id() AND m.status = 'ACTIVE'
  ));

-- Write privileges for the administration of a tenant (B26). Identities are created only through
-- app_find_or_create_person, so users gets no INSERT: the new row would not be visible to the
-- caller yet, and an email of another tenant must not be readable.
GRANT SELECT, INSERT, UPDATE (name, description, permissions, version, archived_at, updated_at)
  ON "tenant_roles" TO mercurio_app;
GRANT INSERT, UPDATE (role, custom_role_id, all_companies, status, version, updated_at)
  ON "memberships" TO mercurio_app;
GRANT INSERT, DELETE ON "membership_companies" TO mercurio_app;
GRANT INSERT ON "companies" TO mercurio_app;

-- ---------------------------------------------------------------------------------------------
-- SECURITY DEFINER functions (B28) for the administration of a tenant.
-- ---------------------------------------------------------------------------------------------

-- The identity with this email, created when there is none. Tells the caller what it needs to
-- decide (new or not, active or disabled, activated, member of other tenants) and nothing else:
-- whether an email exists is already known to the sign-in lookup (app_find_login_subject).
-- Ids come from the caller (UUID v7, B7): PostgreSQL 17 cannot generate them.
CREATE FUNCTION app_find_or_create_person(p_id uuid, p_email text, p_name text)
  RETURNS TABLE (user_id uuid, created boolean, status user_status, activated boolean)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_email text := lower(btrim(p_email));
  v_user uuid;
  v_created boolean := false;
BEGIN
  SELECT u.id INTO v_user FROM public.users u WHERE u.email = v_email;
  IF v_user IS NULL THEN
    INSERT INTO public.users (id, email, name, updated_at)
    VALUES (p_id, v_email, btrim(p_name), now())
    ON CONFLICT (email) DO NOTHING
    RETURNING id INTO v_user;
    v_created := v_user IS NOT NULL;
    IF v_user IS NULL THEN
      -- Created by a concurrent request in the meantime.
      SELECT u.id INTO v_user FROM public.users u WHERE u.email = v_email;
    END IF;
  END IF;
  RETURN QUERY
    SELECT u.id, v_created, u.status,
           EXISTS (SELECT 1 FROM public.credentials c WHERE c.user_id = u.id)
    FROM public.users u WHERE u.id = v_user;
END
$$;

-- A new activation code for a member of the current tenant, only when it cannot take over an
-- account: the identity has never been activated and belongs to no other tenant. A code resets
-- password and two-factor setup in every tenant (app_activate_account), so a tenant
-- administrator must never get one for someone else's account. Recovering an active account stays
-- with the platform operator. Outcome: OK, NOT_MEMBER, ALREADY_ACTIVATED or OTHER_TENANTS.
CREATE FUNCTION app_issue_activation_code(
  p_id uuid, p_user uuid, p_code_hash text, p_expires_at timestamptz
)
  RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_tenant uuid := app_tenant_id();
BEGIN
  -- Lock the person, so a membership added elsewhere meanwhile is seen.
  PERFORM 1 FROM public.users u WHERE u.id = p_user AND u.status = 'ACTIVE' FOR UPDATE;
  IF v_tenant IS NULL OR NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id = p_user AND m.tenant_id = v_tenant AND m.status = 'ACTIVE'
  ) THEN
    RETURN 'NOT_MEMBER';
  END IF;
  IF EXISTS (SELECT 1 FROM public.credentials c WHERE c.user_id = p_user) THEN
    RETURN 'ALREADY_ACTIVATED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id = p_user AND m.tenant_id <> v_tenant AND m.status = 'ACTIVE'
  ) THEN
    RETURN 'OTHER_TENANTS';
  END IF;
  DELETE FROM public.activation_tokens t WHERE t.user_id = p_user AND t.used_at IS NULL;
  INSERT INTO public.activation_tokens (id, user_id, token_hash, expires_at)
  VALUES (p_id, p_user, p_code_hash, p_expires_at);
  RETURN 'OK';
END
$$;

-- What an administrator sees of the people of the current tenant beyond the tenant tables:
-- whether they activated their account, whether a code can be issued from the interface, and
-- when they last used this tenant. Never anything about other tenants but that yes or no.
CREATE FUNCTION app_tenant_member_states()
  RETURNS TABLE (user_id uuid, activated boolean, other_tenants boolean, last_seen_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
  SELECT m.user_id,
         EXISTS (SELECT 1 FROM public.credentials c WHERE c.user_id = m.user_id),
         EXISTS (SELECT 1 FROM public.memberships o
                 WHERE o.user_id = m.user_id AND o.tenant_id <> m.tenant_id
                   AND o.status = 'ACTIVE'),
         (SELECT max(s.last_used_at) FROM public.sessions s
          WHERE s.user_id = m.user_id AND s.selected_tenant_id = m.tenant_id)
  FROM public.memberships m
  WHERE m.tenant_id = app_tenant_id()
$$;

REVOKE EXECUTE ON FUNCTION app_find_or_create_person(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_issue_activation_code(uuid, uuid, text, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_tenant_member_states() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_find_or_create_person(uuid, text, text) TO mercurio_app;
GRANT EXECUTE ON FUNCTION app_issue_activation_code(uuid, uuid, text, timestamptz) TO mercurio_app;
GRANT EXECUTE ON FUNCTION app_tenant_member_states() TO mercurio_app;
