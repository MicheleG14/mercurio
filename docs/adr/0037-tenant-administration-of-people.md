# 0037. Tenant administrators manage people and companies from the interface

- Status: Accepted
- Date: 2026-11-06

## Context

People were added only with terminal commands, as the owner role ([ADR 0010](0010-identity-and-memberships.md)):
a customer could not add a colleague without asking whoever runs the server. Two facts shape what
an administrator may do from the interface:

- an identity is one per person and may belong to several tenants (S4), so a person's name, email,
  password and sessions are not one tenant's to change;
- an activation code resets password and two-factor setup in **every** tenant
  (`app_activate_account`). Whoever gets a code for an account that is already active takes it over.

## Decision

- **The administrator manages memberships, not identities**: adds a person (email, name, role,
  companies), changes role and companies, removes them. Name and email are never changed by the
  tenant. Removing keeps the person and their history (B10) and counts from the next request: there
  is no "sign out everywhere" for an administrator, which would also end the person's work in other
  tenants.
- **Limits**: nobody changes or removes their own membership (`MEMBER_SELF_CHANGE`), and a tenant
  never loses its last active administrator (`LAST_ADMIN`). The check locks the administrators'
  rows before counting, so two administrators removing each other at the same time cannot both
  succeed.
- **Activation codes from the interface only for accounts that cannot be taken over**: an identity
  never activated, that belongs to no other tenant. The privileged function
  `app_issue_activation_code` checks it itself, whatever the API asked, and is the API's only way to
  `activation_tokens`. Recovering an active account stays with the platform operator.
- **The code is handed over by the administrator**: shown once, with a message ready to copy whose
  link carries the code after `#`, as the terminal commands print it: a fragment never reaches the
  server, so it stays out of request logs. No email is sent.
- **Identities through a privileged function.** The API role cannot see people outside its tenant
  nor insert them; `app_find_or_create_person` finds or creates the identity for an email and tells
  only whether it is new, active and activated. That an email exists was already known to the
  sign-in lookup, so nothing new is revealed; the interface tells the administrator that the person
  "already has an account" and will sign in with it.
- **Further companies** are added by whoever has `companies:manage`, with the id chosen by the
  client (B33). Their identity (legal name, VAT number) never changes afterwards; whoever creates a
  company and reaches only listed companies gets the new one in their list.
- New write privileges for the API role, each listed in the guard test (B26): `INSERT` on
  memberships, membership companies, custom roles and companies; `UPDATE` of a membership's role,
  companies and status and of a custom role's name, description, permissions and archive. Never an
  `UPDATE` on `users`.

## Consequences

- From the first sign-in of its administrator, a customer organises itself without the terminal.
- A person who lost their authenticator still needs the operator; so does a person who works for
  other customers and never activated their account.
- Three new `SECURITY DEFINER` functions, reviewed and listed in the catalog test (B28).

## Alternatives considered

- **Email invitations**: an SMTP server, templates and bounce handling, for a portfolio instance
  with fictitious data.
- **Codes for anyone in the tenant**: convenient for a lost authenticator, but it lets an
  administrator take over the account a consultant uses for other customers.
- **An `INSERT` grant on `users`** instead of a function: the new row would not be visible to the
  caller (its policy needs a membership), and looking up an existing email would need a policy
  showing every person to every tenant.
