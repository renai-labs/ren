# @ren/host-api

Internal contracts between Ren and a session's host. Not public: not in `openapi.json` or the generated clients.

- `BrainApi`: the host serves it, Ren calls it.
- `RenHostApi`: Ren serves it, the host calls it.

## What belongs here

- `src/brain-api.ts`: the `BrainApi` and its one group, `brain`.
- `src/ren-host-api.ts`: the `RenHostApi`, which Ren serves and a host calls with its host token: `models.refresh` for its brain's model keys, `environments.access` for its session's environment, directory and environment token, `environments.release` when the session goes idle, and `host.refresh` for a new host token (`Host.Refreshed`). Model access comes as `Brain.ModelGrant` from `@ren/schema/brain`.
- `src/host.ts`: `Host`, the shapes of the Ren Host API that belong to no other module (`Host.Refreshed`).
- `src/errors.ts`: the errors the Brain API and Ren Host API endpoints declare, with HTTP statuses.
- `src/session-token.ts`: the token that authorises a call for one session (`SessionToken.Claims`), its signing keys, and `sign`/`verify`. Core signs, the host verifies, and both use this one implementation.

## What does not

- Request and answer shapes (`Session.StartInput`, `Session.Started`, …). They live in `@ren/schema`, because hosts and Ren use them outside HTTP too.
- Ren's public endpoints (`@ren/protocol`).
- The Environment API, its client and the environment token (`@ren/environment-api`).

## Notes

- Brain API paths sit under `/ren/`, because the harness's own API shares the origin and owns `/api/*` (OpenCode).
- Both sides build on the same value: the host with `HttpApiBuilder` and core with `HttpApiClient`. A change here changes both.
- The Ren server and a host deploy separately, so a change must work with the previous version on the other side.

## Dependencies

`@ren/schema`, `effect`.

## Commands

```sh
bun run test
bun typecheck
```
