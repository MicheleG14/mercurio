# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Each phase of the [roadmap](README.md#roadmap) ends with
a release.

## [0.1.0] - Unreleased

Phase 0: walking skeleton. The full path from code to production works end to end, with no business
features yet.

### Added

- pnpm monorepo with a NestJS 12 API (`apps/api`) and a React 19 + Vite web app (`apps/web`).
- `GET /api/health`, reporting the API version, uptime and database reachability (`503` when the
  database does not answer within two seconds).
- Status page showing the health report, refreshed every 15 seconds.
- Light, dark and system themes; Italian and English interface.
- Design tokens for the amethyst and amber palette, Geist fonts bundled with the app.
- Configuration validated at startup, configurable base path (`APP_BASE_PATH`).
- Structured logs with a correlation id per request, security headers, global rate limit.
- PostgreSQL 17 with Prisma 7.
- Docker image (multi-stage, non-root) serving the API and the web app, Docker Compose for
  development and production, nginx location, deployment script.
- Quality tooling: Vitest, Testing Library, oxlint, Prettier, Husky, lint-staged, commitlint.
- GitHub Actions CI: format, type check, lint, unit and end-to-end tests, build, Docker image.
- Continuous delivery: CI publishes the images to GitHub Container Registry, a version tag deploys
  them over SSH with a key restricted to the deployment script, any version can be redeployed by
  hand.
- Documentation: architecture, conventions, glossary, first architecture decision records.
