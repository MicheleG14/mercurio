# 0004. The API serves the web app (single origin)

- Status: Accepted
- Date: 2026-10-19

## Context

Mercurio has a NestJS API and a React single-page app. Both run behind nginx under one path prefix
(e.g. `/mercurio`). Authentication will use an `HttpOnly` refresh-token cookie, which is simplest and
safest when the browser sees the web app and the API as the same origin.

## Decision

- In production a **single container** runs the API, which also serves the built web app as static
  files: the UI under `<base>/`, the API under `<base>/api`.
- Unknown paths under the base path return `index.html`, so client-side routes survive a reload; API
  paths keep their JSON 404.
- Hashed build assets are cached for a year (`immutable`); `index.html` is always revalidated, so a
  new deployment is visible at once.
- The base path comes from `APP_BASE_PATH`: empty in local development (served from the root),
  `/mercurio` in production. The same code runs in both.
- In development, Vite serves the web app and proxies `<base>/api` to the API, so the browser still
  sees one origin.

## Consequences

- No CORS configuration, and cookies need no cross-site settings.
- One image, one process and one upstream for nginx.
- The web app and the API are always deployed together, at the same version.
- The base path is baked into the web build (asset URLs), so it is a Docker build argument.

## Alternatives considered

- **nginx serves the static files**: marginally faster for assets, but splits the deployment in two
  and puts application routing rules (SPA fallback, cache headers) in the server configuration.
- **Separate origins** (e.g. a CDN for the UI): requires CORS and cross-site cookies, more surface
  for mistakes, no benefit at this scale.
