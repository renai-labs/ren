# @ren/environment-api

The Environment API: the internal contract between a brain and the executor on its environment (a container, a laptop, a phone). A brain (`packages/brain`) calls it; an executor (`packages/executor`) serves it; Ren (`packages/core`) signs the token that lets one brain use the executor of one environment.

## What belongs here

- `src/environment-api.ts`: `EnvironmentApi`. `EnvironmentApi.Rpcs` is the Effect `RpcGroup` that an executor serves at `POST /v1/rpc` and a brain calls with an environment token. Its shapes, its errors, the `Authentication` middleware and the `Caller` live beside it.
- `src/environment-client.ts`: `EnvironmentClient`, the typed client of `EnvironmentApi.Rpcs` (`make`, `Client`) and the RPC `path`.
- `src/environment-token.ts`: the token that lets one brain use the executor of one environment (`EnvironmentToken.Claims`).
- `src/signature.ts`: Ed25519 keys, their variables (`ENVIRONMENT_KEYS` for Ren, `ENVIRONMENT_PUBLIC_KEYS` for executors), `sign`, `verify` and `generate`. Only Ren holds the private key; brains and executors verify with public keys, so a brain that can read its own files still cannot sign.
- `src/signal.ts`: the signal names a process can get or exit by.

## Notes

- The Environment API is RPC, not `HttpApi`: it is not in OpenAPI and has no HTTP statuses. Its one path is `/v1/rpc`. An executor checks the environment token on the HTTP request before the RPC server decodes a payload; every RPC declares `UnauthorizedError` through the `Authentication` middleware. `EnvironmentClient.make` maps an HTTP 401 to that typed error after one retry with the token read again. Each unary call has a time limit (`answerWithin`); a call that ends without an answer calls `onNoAnswer`.
- Both sides build on the same value: the executor with `RpcServer` and a brain with `EnvironmentClient.make`. A change here changes both.
- A brain and an executor deploy separately, so a change must work with the previous version on the other side.

## Dependencies

`@ren/schema`, `effect`, `jose`.

## Commands

```sh
bun run test
bun typecheck
bun run keys [id]   # print a new Ed25519 key pair for development
```
