#!/usr/bin/env bash
# Runs Docker Compose on the production deployment, the way deploy.sh does: from the deployment
# folder, with --env-file .env.production and docker-compose.prod.yml, and with the version of the
# app that is running now, so that a terminal command uses the same image.
#
# Lives in the deployment folder next to deploy.sh. Examples:
#   ./compose.sh ps
#   ./compose.sh run --rm cli verify-invoicing
#   APP_VERSION=1.0.0 ./compose.sh run --rm cli seed-demo     another version, on purpose
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

ENV_FILE=.env.production
if [[ ! -f $ENV_FILE ]]; then
  echo "Missing $ENV_FILE: run this from the deployment folder." >&2
  exit 1
fi

if [[ -z ${APP_VERSION:-} ]]; then
  DEPLOYMENT="$(grep -E '^MERCURIO_DEPLOYMENT=' "$ENV_FILE" | cut -d= -f2- || true)"
  if [[ -z $DEPLOYMENT ]]; then
    echo "MERCURIO_DEPLOYMENT is not set in $ENV_FILE (see .env.production.example)." >&2
    exit 1
  fi
  # The image of the running app container, e.g. ghcr.io/micheleg14/mercurio:0.8.0.
  IMAGE="$(docker ps \
    --filter "label=com.docker.compose.project=mercurio-$DEPLOYMENT" \
    --filter "label=com.docker.compose.service=app" \
    --format '{{.Image}}' | head -n 1)"
  if [[ -z $IMAGE ]]; then
    echo "No app container is running: set APP_VERSION to choose the version." >&2
    exit 1
  fi
  APP_VERSION="${IMAGE##*:}"
fi
export APP_VERSION

exec docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml "$@"
