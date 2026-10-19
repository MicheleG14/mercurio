#!/usr/bin/env bash
# Deploys Mercurio on this server from the current Git checkout:
# pull, build the images, run the migrations, restart the app, wait until it is healthy.
#
# Usage (from the deployment checkout, not the development one):
#   deploy/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=.env.production
if [[ ! -f $ENV_FILE ]]; then
  echo "Missing $ENV_FILE: copy .env.production.example and set a real password." >&2
  exit 1
fi

compose() { docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml "$@"; }

git pull --ff-only
# The commit becomes the version shown by /api/health and the image tag.
APP_VERSION="$(git rev-parse --short HEAD)"
export APP_VERSION
BASE_PATH="$(grep -E '^APP_BASE_PATH=' "$ENV_FILE" | cut -d= -f2-)"
HEALTH_URL="http://127.0.0.1:8001${BASE_PATH:-/mercurio}/api/health"

echo "Deploying $APP_VERSION"
compose build --pull
# `migrate` runs first and must succeed: the app depends on it (see docker-compose.prod.yml).
compose up -d --remove-orphans

for _ in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" > /dev/null; then
    echo "Healthy: $APP_VERSION at $HEALTH_URL"
    docker image prune -f --filter "label=com.docker.compose.project=mercurio-prod" > /dev/null
    exit 0
  fi
  sleep 2
done

echo "Health check failed after 60 s. Last logs:" >&2
compose logs --tail 50 app >&2
exit 1
