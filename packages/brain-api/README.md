# @ren/brain-api

The Brain API: the internal HTTP contract between the Ren server and whatever hosts a session. Core's `BrainHost` calls it; a host (the cell in `packages/cell`) serves it. Not part of Ren's public API (`@ren/protocol`), not in `openapi.json` and not in the generated clients.

## What belongs here

- `src/brain-api.ts`: the `BrainApi` and its one group, `brain`.
- `src/errors.ts`: the errors its endpoints declare, with HTTP statuses.
- `src/session-token.ts`: the token that authorises a call for one session (`SessionToken.Claims`), its signing keys, and `sign`/`verify`. Core signs, the host verifies, and both use this one implementation.

## What does not

- Request and answer shapes (`Session.StartInput`, `Session.Started`, …). They live in `@ren/schema`, because hosts and Ren use them outside HTTP too.
- Ren's public endpoints (`@ren/protocol`).

## Notes

- Paths sit under `/ren/`, because the harness's own API shares the origin and owns `/api/*` (OpenCode).
- Both sides build on the same `BrainApi` value: the host with `HttpApiBuilder`, core with `HttpApiClient`. A change here changes both.
- The Ren server and a host deploy separately, so a change must work with the previous version on the other side.

## Dependencies

`@ren/schema`, `effect`.

## Commands

```sh
bun run test
bun typecheck
```
