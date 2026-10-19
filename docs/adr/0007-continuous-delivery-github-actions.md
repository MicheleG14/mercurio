# 0007. Continuous delivery with GitHub Actions and GHCR

- Status: Accepted
- Date: 2026-10-19

## Context

Mercurio runs on a single server, next to other applications. Until now a deployment meant logging
in, pulling the repository and building the Docker images on the server: slow, heavy on a shared
machine, and manual. The repository is public and already uses GitHub Actions for CI.

We want deployments that are repeatable, traceable to a commit, easy to roll back, and that give
GitHub as little access to the server as possible.

## Decision

- **CI builds and publishes** the images to GitHub Container Registry: `mercurio` (the app) and
  `mercurio-migrate` (database migrations). Every push to `main` publishes `sha-<commit>` and
  `latest`; a version tag `vX.Y.Z` publishes `X.Y.Z`. Pull requests only build.
- **A version tag deploys.** After the images are published, the `deploy` workflow connects to the
  server over SSH and runs `deploy.sh <version>`. The same workflow can be started by hand for any
  published version, which is also how a rollback is done.
- **The server only pulls.** The deployment folder holds `docker-compose.prod.yml`, `deploy.sh` and
  `.env.production`: no source checkout, no build tools, no repository credentials. The script pulls
  the images, runs migrations, restarts the app and waits until `/api/health` reports the requested
  version.
- **Narrow SSH access.** GitHub uses a key dedicated to deployments, for a user without sudo, and
  `authorized_keys` restricts it to the deployment script (`command="…",restrict`): no shell, no
  forwarding. The version is the only input and is validated on both sides. The server's host key is
  pinned in the workflow. Key, host and user are secrets of the `production` environment.

## Consequences

- The server spends no CPU or memory on builds; a deployment takes seconds.
- Every running version maps to an image and a commit; rolling back is redeploying an older tag.
- The images are public, like the code. They contain no secrets: those stay in `.env.production`.
- GitHub can trigger a deployment, but cannot run anything else on the server.
- `docker-compose.prod.yml` and `deploy.sh` on the server are updated by copying them when they
  change, which is rare.
- A failed health check stops the deployment and prints the logs; it does not roll back by itself,
  because migrations may already have run.

## Alternatives considered

- **Jenkins or another self-hosted CI** (Drone, Woodpecker): one more always-on service on the
  server, with a web interface to secure and keep updated, duplicating what GitHub Actions does.
- **Self-hosted GitHub runner on the server**: discouraged by GitHub for public repositories, because
  pull requests from forks could run code on the machine.
- **The server polls the registry** (timer or Watchtower): GitHub needs no access at all, but
  deployments are delayed and their outcome is not visible in GitHub.
- **Build on the server** (the previous script): slow and heavy on a shared machine.
