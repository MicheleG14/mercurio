#!/usr/bin/env bash
# Deploys one published version of Mercurio on this server: pull the images from GitHub
# Container Registry, run the migrations, restart the app, wait until it is healthy.
# Nothing is built here.
#
# Lives in the deployment folder next to docker-compose.prod.yml and .env.production.
#
# Usage:
#   ./deploy.sh 0.1.0            a release
#   ./deploy.sh sha-1a2b3c4      any commit published from main
#
# GitHub Actions runs it over SSH with a key restricted to this script (forced command):
# the requested version then arrives in SSH_ORIGINAL_COMMAND.
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

VERSION="${SSH_ORIGINAL_COMMAND:-${1:-}}"
# Strict format: the value comes from the network and ends up in image names.
if [[ ! $VERSION =~ ^([0-9]+\.[0-9]+\.[0-9]+|sha-[0-9a-f]{7})$ ]]; then
  echo "Usage: deploy.sh <version>   (e.g. 0.1.0 or sha-1a2b3c4)" >&2
  exit 2
fi

ENV_FILE=.env.production
if [[ ! -f $ENV_FILE ]]; then
  echo "Missing $ENV_FILE: copy .env.production.example and set a real password." >&2
  exit 1
fi

compose() { docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml "$@"; }

export APP_VERSION="$VERSION"
BASE_PATH="$(grep -E '^APP_BASE_PATH=' "$ENV_FILE" | cut -d= -f2-)"
HEALTH_URL="http://127.0.0.1:8001${BASE_PATH:-/mercurio}/api/health"

echo "Deploying $APP_VERSION"
compose pull --quiet migrate app
# `migrate` runs first and must succeed: the app depends on it (see docker-compose.prod.yml).
compose up -d --no-build --remove-orphans

for _ in $(seq 1 30); do
  # Healthy and running the requested version, not a container left from before.
  if curl -fsS "$HEALTH_URL" 2> /dev/null | grep -q "\"version\":\"$APP_VERSION\""; then
    echo "Healthy: $APP_VERSION"
    # Older Mercurio images are no longer used; a rollback pulls them again.
    docker image prune -af \
      --filter "label=org.opencontainers.image.source=https://github.com/MicheleG14/mercurio" \
      > /dev/null
    exit 0
  fi
  sleep 2
done

echo "Health check failed after 60 s. Last logs:" >&2
compose logs --tail 50 app >&2
exit 1
