# 0036. Custom roles per tenant, built-in roles in code

- Status: Accepted
- Date: 2026-11-06

## Context

Until phase 7 a person's role was one of four, fixed in code: administrator, warehouse keeper,
accountant, read only ([ADR 0014](0014-authorization.md)). A customer who organises work
differently (a salesperson who handles customers and orders but not invoices, a warehouse keeper of
one site only) had nothing to choose. The code already checks permissions and never roles, so what
a role means can change without touching a single route.

## Decision

- **Two kinds of role.** The four built-in roles stay in code (`ROLE_PERMISSIONS`): they are the
  same for every tenant and gain the permissions of new modules with each release. A tenant can
  also define its own roles, rows of `tenant_roles` with a name and a set of permissions. A
  membership holds exactly one of the two (`role` or `custom_role_id`, checked by the database),
  and the foreign key to a custom role includes `tenant_id`, so it can never point to another
  tenant's role (B25).
- **Built-in roles are never changed**, only duplicated: the copy is a custom role, with
  `based_on` recording where it came from. "Accountant" means the same thing everywhere.
- **Reserved permissions.** `members:manage` and `roles:manage` belong to the built-in
  administrator only. A custom role cannot hold them, or whoever manages people could make a role
  with everything and give it to themselves. Code and a `CHECK` on `tenant_roles.permissions` refuse
  them; a test compares the `CHECK` with the catalog.
- **A role is consistent.** Each permission lists what it needs (`invoicing:issue` needs
  `invoicing:write`, which needs `invoicing:read`); a role must hold the whole chain. The role editor
  ticks and unticks the chain as the person clicks, and the API refuses an incomplete role
  (`ROLE_PERMISSIONS_INCOMPLETE`).
- **Permissions of modules not enabled can be saved.** They have no effect, because the module guard
  still refuses the routes, and the role works as soon as the tenant buys the module.
- **Permissions are read on every request**, with the membership, in the same query plan as before
  (the custom role is one more lookup). Changing a role's permissions counts from the next request
  of everyone holding it.
- **Custom roles are archived, not deleted** (B31), and only when nobody holds them. The name, unique
  among the roles in use whatever the case, becomes free again; it cannot be the name of a built-in
  role in any language of the interface.

## Consequences

- A customer shapes roles around its own work, from the interface, without a release.
- A new module's permissions reach the built-in roles by themselves, but never a custom role: the
  role page says so, and the administrator decides.
- `/auth/me` and the tenant choice describe a role as `{ kind, key, id, name }` instead of a key:
  the interface translates built-in roles and shows custom ones as named.

## Alternatives considered

- **Fixed roles only**: little work, but every customer has to fit the same four shapes.
- **Built-in roles copied into each tenant as rows**: one model instead of two, but every new
  permission would need a migration over rows the customer may have changed.
- **Permissions given to each person**: the most flexible, and with ten people impossible to review.
- **One text column for the role** (a key or an id): no foreign key and no `CHECK`.
