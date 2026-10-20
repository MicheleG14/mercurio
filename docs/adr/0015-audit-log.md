# 0015. Audit log: two append-only tables

- Status: Accepted
- Date: 2026-10-20

## Context

Administrators need to know who did what in their tenant, and the person needs to see recent
sign-ins on their account. Some events happen before any tenant is chosen (a failed sign-in), others
belong to a tenant (a member added). A record that can be edited proves nothing.

## Decision

- **`auth_events`** (platform table): security events of a person — activation, sign-ins, failed
  attempts, lockout, password and recovery codes, sign-outs. Row-Level Security shows a person only
  their own events. An attempt with an unknown email is recorded without the email (text chosen by
  whoever is trying is not stored).
- **`audit_events`** (tenant table, with the standard tenant isolation of ADR 0008): events inside a
  tenant, with actor, source (`API` or `CLI`), subject and small structured details. Readable through
  the API with the `audit:read` permission (administrators). Business actions of later phases (an
  invoice issued) are added here.
- **Append-only**: the API role can only insert and read; a trigger refuses updates and deletes for
  everyone, the owner role included. Removing it requires a deliberate migration.
- **Same transaction**: an event is written with the change it describes, so neither exists without
  the other. Terminal commands record their changes with source `CLI` and no actor.
- Events never contain passwords, codes, tokens or secrets.

## Consequences

- Two queries for the two views, each with one simple visibility rule.
- IP address and browser are kept for security events, with no expiry for now; a retention period
  will be set together with a cleanup command.
- Test data is removed by the owner with triggers disabled for its own transaction only.

## Alternatives considered

- **One table with an optional `tenant_id`**: the Row-Level Security rule would need an exception for
  rows without a tenant, the only one in the schema.
- **Writing events to the application logs**: logs are not queryable per tenant and are not tamper
  resistant.
