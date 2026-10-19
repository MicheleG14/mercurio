# syntax=docker/dockerfile:1

# Same Node version as .node-version, so development, CI and production match.
ARG NODE_VERSION=24.22.0

# ---------- base: Node + pnpm ----------
FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# ---------- build: compile the web app and the API ----------
FROM base AS build
# Manifests first: the dependency layer is rebuilt only when they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
# The base path is baked into the web build (asset URLs), so it is a build argument.
ARG APP_BASE_PATH=/mercurio
RUN APP_BASE_PATH=$APP_BASE_PATH pnpm --filter @mercurio/web build \
 && pnpm --filter @mercurio/api build

# ---------- prod-deps: only what the API needs at runtime ----------
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @mercurio/api

# ---------- migrator: applies database migrations, then exits ----------
FROM build AS migrator
WORKDIR /repo/apps/api
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# ---------- runtime: the image that runs in production ----------
FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    WEB_DIST_PATH=/app/apps/web/dist
ARG APP_BASE_PATH=/mercurio
ARG APP_VERSION=dev
ENV APP_BASE_PATH=$APP_BASE_PATH \
    APP_VERSION=$APP_VERSION
WORKDIR /app
# pnpm keeps real packages in node_modules/.pnpm and links them, so both levels are copied.
COPY --from=prod-deps --chown=node:node /repo/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /repo/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /repo/apps/web/dist ./apps/web/dist
# Never run as root inside the container.
USER node
WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}${process.env.APP_BASE_PATH}/api/health`).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/main.js"]
