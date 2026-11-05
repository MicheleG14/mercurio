# 0035. The production Compose file works only in the deployment folder

- Status: Accepted
- Date: 2026-11-05
- Refines: [0007](0007-continuous-delivery-github-actions.md)

## Context

`docker-compose.prod.yml` is the same file in the repository and in the deployment folder, and its
project name was fixed. In a checkout, Compose reads the development `.env`, whose database
settings satisfied the variables the file requires: a command typed there recreated the production
database container with the development settings. The data survived, because PostgreSQL ignores
those settings once its data folder exists, but nothing had stopped the command.

## Decision

- The project name is `mercurio-${MERCURIO_DEPLOYMENT}`, and the variable is required. Only
  `.env.production` sets it: `prod`, so the project and the database volume keep the names they
  already have. Trying the images locally uses another value, so another project and volume.
- `deploy/compose.sh`, next to `deploy.sh` in the deployment folder, runs Compose with
  `--env-file .env.production` and the version of the app that is running: terminal commands use
  it (`./compose.sh run --rm cli verify-invoicing`).
- CI checks that the file refuses to start without the variable, and that with `prod` the project
  and the volume keep their names.

## Consequences

- A command typed in a checkout stops before touching any container.
- The server needs the variable in `.env.production` before a deployment with this file; without it
  the deployment stops at the start, without changing anything.

## Alternatives considered

- **Only the wrapper script**: the file itself would stay dangerous in a checkout.
- **Renaming the development `.env`**: it protects from this one case, not from the next variable
  that happens to be set.
