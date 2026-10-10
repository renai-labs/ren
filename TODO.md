# TODO

Work deferred during scaffolding. Pick items up when they become relevant, and move them to GitHub issues once the repo uses issues.

## Deployment and infrastructure

- [ ] `services/*`: independently deployed units, each a Bun workspace with its own deploy workflow and a `services/README.md` table (service, purpose, deployment).
- [ ] `infra/`: cloud resources.
- [ ] `deploy-*` workflows for the API, app and site.

## Migration from ren-v1

- [ ] Write the migration plan in `specs/v1-migration.md`.
- [ ] Migrate the domains into `schema` / `protocol` / `db` / `core` / `server`, one at a time.
- [ ] Migrate the remaining v1 packages: `registry`, `qa`, `media`.

## Testing

- [ ] `http-recorder`: record real HTTP/WebSocket traffic once, then replay it from cassettes (`RECORD=true` to re-record). Use it for integrations (Slack, Linear, E2B, …) instead of MSW mocks.
- [ ] `simulation` package: backend/frontend simulation harness.
- [ ] Generate a `client/react` entrypoint (TanStack Query hooks) from the HttpApi.

## App and site

- [ ] `app`: add TanStack Router and Query, Tailwind 4 and Base UI (the ren-v1 stack).
- [ ] `site`: render the API reference from `packages/protocol/openapi.json`.
- [ ] CI: install and cache Playwright Chromium in the `e2e` job once browser tests exist. Today's e2e tests are API and CLI only.

## CLI

- [ ] Choose a command framework for `ren` (e.g. Effect's `effect/cli`) before adding real commands.

## Tooling

- [ ] Custom oxlint plugins (anti-slop + Effect rules).
- [ ] `lint:changed`: apply strict lint warnings only to changed files in the UI packages.
- [ ] Typecheck profiling scripts (`typecheck:profile`) once typecheck gets slow.
- [ ] Add `patches/` + `patchedDependencies` the first time a dependency needs a patch (ren-v1 already patches `@standard-community/standard-openapi`).
- [ ] Flesh out the `ren-dev` skill once the server, logs and DB workflow exist.
- [ ] Move to TypeScript 7 (stable `tsc` is native) once `@astrojs/check` supports it (its peer range is `^5 || ^6`). Then decide whether to drop `@typescript/native-preview`.
- [ ] Bump `effect` / `@effect/*` together with a `repos/effect` subtree pull.
- [ ] Drizzle RC: `db.execute` is typed as an array but returns `{ rows }` at runtime. Re-check on the next drizzle-orm upgrade.

## Publishing

- [ ] Publish pipeline for `@renai-labs/sdk` and `@renai-labs/cli`: `script/publish.ts` rewrites `exports` to `dist`, then packs and publishes.
- [ ] Release workflow and version bump script (one shared version).
- [ ] `CHANGELOG.md`.
- [ ] `SECURITY.md`.

## GitHub automation

- [ ] `CODEOWNERS` once there are multiple owners.
- [ ] `pr-standards.yml`: enforce the `type(scope): summary` title and a linked issue.
- [ ] `/review` comment workflow that runs an AI code review.
- [ ] Issue triage and duplicate-detection workflows.
