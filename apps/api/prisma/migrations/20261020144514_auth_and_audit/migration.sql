-- CreateEnum
CREATE TYPE "audit_source" AS ENUM ('API', 'CLI');

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "source" "audit_source" NOT NULL,
    "type" TEXT NOT NULL,
    "subject_type" TEXT,
    "subject_id" UUID,
    "details" JSONB,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credentials" (
    "user_id" UUID NOT NULL,
    "password_hash" TEXT NOT NULL,
    "totp_secret_enc" TEXT,
    "totp_confirmed_at" TIMESTAMPTZ(6),
    "totp_last_step" BIGINT,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "selected_tenant_id" UUID,
    "refresh_hash" TEXT NOT NULL,
    "previous_refresh_hash" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "absolute_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_events" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "type" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "details" JSONB,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_events_tenant_id_at_idx" ON "audit_events"("tenant_id", "at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "recovery_codes_code_hash_key" ON "recovery_codes"("code_hash");

-- CreateIndex
CREATE INDEX "recovery_codes_user_id_idx" ON "recovery_codes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_hash_key" ON "sessions"("refresh_hash");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_previous_refresh_hash_key" ON "sessions"("previous_refresh_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "auth_events_user_id_at_idx" ON "auth_events"("user_id", "at" DESC);

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_selected_tenant_id_fkey" FOREIGN KEY ("selected_tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================================================================================
-- Written by hand from here on: Row-Level Security, grants, the append-only trigger and the
-- three SECURITY DEFINER functions. See docs/adr/0012, 0013, 0015 and conventions B25, B26, B28.
-- ===========================================================================================

ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_type_format" CHECK (type ~ '^[A-Z_]+$');
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_type_format" CHECK (type ~ '^[A-Z_]+$');

-- ---------------------------------------------------------------------------------------------
-- Platform tables of a person: visible only to that person (user_id = the current user).
-- Everything the API may do on them is granted per operation and, for updates, per column.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "credentials" FORCE ROW LEVEL SECURITY;
CREATE POLICY own_row ON "credentials"
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());

ALTER TABLE "recovery_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recovery_codes" FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON "recovery_codes"
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());

ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON "sessions"
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());

-- Security events: a person reads their own. Anyone may add an event about themselves, or about
-- nobody (a failed sign-in with an unknown email has no user).
ALTER TABLE "auth_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_own ON "auth_events" FOR SELECT USING (user_id = app_user_id());
CREATE POLICY add_own_or_anonymous ON "auth_events" FOR INSERT
  WITH CHECK (user_id IS NULL OR user_id = app_user_id());

-- The audit log of a tenant is a tenant table like any other (B25).
SELECT mercurio_enable_tenant_isolation('audit_events');

-- The credentials row is created by app_activate_account, so there is no INSERT grant. The
-- password hash can change (change of password); the refresh hashes only through app_rotate_session.
GRANT SELECT, UPDATE (password_hash, totp_secret_enc, totp_confirmed_at, totp_last_step,
  failed_attempts, locked_until, updated_at) ON "credentials" TO mercurio_app;
GRANT SELECT, INSERT, UPDATE (used_at) ON "recovery_codes" TO mercurio_app;
GRANT SELECT, INSERT, UPDATE (selected_tenant_id, last_used_at, revoked_at) ON "sessions"
  TO mercurio_app;
GRANT SELECT, INSERT ON "auth_events", "audit_events" TO mercurio_app;

-- ---------------------------------------------------------------------------------------------
-- Append-only: updates and deletes of audit rows are refused, whoever asks. A migration or an
-- administrator can still drop the trigger, but not by accident.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION mercurio_refuse_audit_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON "auth_events"
  FOR EACH ROW EXECUTE FUNCTION mercurio_refuse_audit_change();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION mercurio_refuse_audit_change();

-- ---------------------------------------------------------------------------------------------
-- SECURITY DEFINER functions (B28): the only three ways in for a request that has no identity
-- yet (sign-in, activation, token refresh). They run with the owner's rights, so each one is
-- short, pins search_path, returns the minimum and is executable by mercurio_app alone.
-- A test lists them and fails if a new one appears without review.
-- ---------------------------------------------------------------------------------------------

-- Sign-in: who owns this email? Only the id and the status leave the function.
CREATE FUNCTION app_find_login_subject(p_email text)
  RETURNS TABLE (user_id uuid, status user_status)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$ SELECT u.id, u.status FROM public.users u WHERE u.email = lower(btrim(p_email)) $$;

-- Activation, in one statement chain: redeem the code (valid, unused, user active), set the new
-- password, reset the two-factor setup and close every session. Returns the user, or NULL when
-- the code is not valid. Used for recovery too: a new code for an active account starts over.
CREATE FUNCTION app_activate_account(p_code_hash text, p_password_hash text)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_user uuid;
BEGIN
  UPDATE public.activation_tokens t SET used_at = now()
  FROM public.users u
  WHERE t.token_hash = p_code_hash AND t.used_at IS NULL AND t.expires_at > now()
    AND u.id = t.user_id AND u.status = 'ACTIVE'
  RETURNING t.user_id INTO v_user;
  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.credentials (user_id, password_hash, updated_at)
  VALUES (v_user, p_password_hash, now())
  ON CONFLICT (user_id) DO UPDATE SET
    password_hash = excluded.password_hash,
    totp_secret_enc = NULL, totp_confirmed_at = NULL, totp_last_step = NULL,
    failed_attempts = 0, locked_until = NULL, updated_at = now();
  UPDATE public.recovery_codes SET used_at = now() WHERE user_id = v_user AND used_at IS NULL;
  UPDATE public.sessions SET revoked_at = now() WHERE user_id = v_user AND revoked_at IS NULL;
  RETURN v_user;
END
$$;

-- Refresh: swap the refresh token of a session for a new one. Seeing a token that was already
-- swapped means it was copied, so the whole session is closed. The outcome tells the caller what
-- happened: OK, REUSED, REVOKED, EXPIRED or UNKNOWN. Row ids are returned only when known.
CREATE FUNCTION app_rotate_session(p_old_hash text, p_new_hash text, p_idle_seconds integer)
  RETURNS TABLE (outcome text, out_session_id uuid, out_user_id uuid, out_tenant_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  s public.sessions%ROWTYPE;
  v_active boolean;
BEGIN
  SELECT * INTO s FROM public.sessions WHERE refresh_hash = p_old_hash FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO s FROM public.sessions WHERE previous_refresh_hash = p_old_hash FOR UPDATE;
    IF FOUND THEN
      UPDATE public.sessions SET revoked_at = coalesce(revoked_at, now()) WHERE id = s.id;
      RETURN QUERY SELECT 'REUSED', s.id, s.user_id, s.selected_tenant_id;
    ELSE
      RETURN QUERY SELECT 'UNKNOWN', NULL::uuid, NULL::uuid, NULL::uuid;
    END IF;
    RETURN;
  END IF;

  SELECT (u.status = 'ACTIVE') INTO v_active FROM public.users u WHERE u.id = s.user_id;
  IF s.revoked_at IS NOT NULL OR NOT v_active THEN
    RETURN QUERY SELECT 'REVOKED', s.id, s.user_id, s.selected_tenant_id;
  ELSIF now() > s.absolute_expires_at
     OR now() > s.last_used_at + make_interval(secs => p_idle_seconds) THEN
    UPDATE public.sessions SET revoked_at = now() WHERE id = s.id;
    RETURN QUERY SELECT 'EXPIRED', s.id, s.user_id, s.selected_tenant_id;
  ELSE
    UPDATE public.sessions
    SET previous_refresh_hash = refresh_hash, refresh_hash = p_new_hash, last_used_at = now()
    WHERE id = s.id;
    RETURN QUERY SELECT 'OK', s.id, s.user_id, s.selected_tenant_id;
  END IF;
END
$$;

REVOKE EXECUTE ON FUNCTION app_find_login_subject(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_activate_account(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_rotate_session(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_find_login_subject(text) TO mercurio_app;
GRANT EXECUTE ON FUNCTION app_activate_account(text, text) TO mercurio_app;
GRANT EXECUTE ON FUNCTION app_rotate_session(text, text, integer) TO mercurio_app;
