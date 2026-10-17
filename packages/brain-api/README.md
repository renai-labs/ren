# @ren/brain-api

The Brain API: the internal HTTP contract between the Ren server and whatever hosts a session. Core's `BrainHost` calls it; a host (the cell in `packages/cell`) serves it. Not part of Ren's public API (`@ren/protocol`), not in `openapi.json` and not in the generated clients.

## What belongs here

- `src/brain-api.ts`: the `BrainApi` and its one group, `brain`.
- `src/host-api.ts`: the `HostApi`, which Ren serves and a host calls with its host token: `models.refresh` for its brain's model keys, `environments.access` for its session's sandbox, folder and environment token, and `host.refresh` for a new host token.
- `src/executor-api.ts`: the `ExecutorApi`, an Effect `RpcGroup` that an executor serves on an environment's machine at `POST /v1/rpc` and a brain calls with an environment token. Its shapes, its errors, the `Authentication` middleware, the `Caller` live beside it.
- `src/executor-client.ts`: `ExecutorClient`, the typed client of the `ExecutorApi` (`make`, `Client`) and the RPC `path`.
- `src/errors.ts`: the errors the Brain and Models API endpoints declare, with HTTP statuses.
- `src/session-token.ts`: the token that authorises a call for one session (`SessionToken.Claims`), its signing keys, and `sign`/`verify`. Core signs, the host verifies, and both use this one implementation.
- `src/signature.ts`: Ed25519 keys, their variables (`BRAIN_SIGNING_KEY`, `BRAIN_PUBLIC_KEYS`), `sign`, `verify` and `generate`. Only Ren holds the private key; brains and executors verify with public keys, so a brain that can read its own files still cannot sign.
- `src/environment-token.ts`: the token that lets one brain use one environment's executor (`EnvironmentToken.Claims`).

## What does not

- Request and answer shapes (`Session.StartInput`, `Session.Started`, …). They live in `@ren/schema`, because hosts and Ren use them outside HTTP too.
- Ren's public endpoints (`@ren/protocol`).

## Notes

- The Executor API is RPC, not `HttpApi`: it is not in OpenAPI and has no HTTP statuses. Its one path is `/v1/rpc`. An executor checks the environment token on the HTTP request before the RPC server decodes a payload; every RPC declares `UnauthorizedError` through the `Authentication` middleware. `ExecutorClient.make` maps an HTTP 401 to that typed error; given `renew`, it runs it and retries the call once first. A 401 comes before the executor runs anything, so the retry is safe. Each unary call has a time limit (`answerWithin`); a call that ends without an answer calls `onNoAnswer`.
- Brain API paths sit under `/ren/`, because the harness's own API shares the origin and owns `/api/*` (OpenCode).
- Both sides build on the same value: for `BrainApi`, the host with `HttpApiBuilder` and core with `HttpApiClient`; for `ExecutorApi`, the executor with `RpcServer` and a brain with `ExecutorClient.make`. A change here changes both.
- The Ren server and a host deploy separately, so a change must work with the previous version on the other side.

## Dependencies

`@ren/schema`, `effect`, `jose`.

## Commands

```sh
bun run test
bun typecheck
bun run keys [id]   # print a new Ed25519 key pair for development
```
