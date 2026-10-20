/** Security events of a person, recorded outside any tenant (table auth_events). */
export const AUTH_EVENT_TYPES = [
  'ACCOUNT_ACTIVATED',
  'MFA_ENROLLED',
  'LOGIN_SUCCEEDED',
  'LOGIN_FAILED',
  'MFA_FAILED',
  'RECOVERY_CODE_USED',
  'ACCOUNT_LOCKED',
  'PASSWORD_CHANGED',
  'RECOVERY_CODES_REGENERATED',
  'SESSION_REFRESH_REUSED',
  'LOGGED_OUT',
  'LOGGED_OUT_ALL',
  'ACCOUNT_RECOVERY_ISSUED',
  'SESSIONS_REVOKED',
] as const;
export type AuthEventType = (typeof AUTH_EVENT_TYPES)[number];

/** Events inside a tenant (table audit_events). Business actions join this list in later phases. */
export const AUDIT_EVENT_TYPES = [
  'TENANT_SELECTED',
  'TENANT_CREATED',
  'MEMBER_ADDED',
  'MEMBER_REMOVED',
  'MODULES_CHANGED',
  'COMPANY_ADDED',
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];
