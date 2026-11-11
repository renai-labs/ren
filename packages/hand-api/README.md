# @ren/hand-api

The Hand API: the internal contract between a brain and the executor on its hand (a container, a laptop, a phone). A brain (`packages/brain`) calls it; an executor (`packages/executor`) serves it; Ren (`packages/core`) signs the token that lets one brain use the executor of one hand.

## What belongs here

- `src/hand-api.ts`: `HandApi`. `HandApi.Rpcs` is the Effect `RpcGroup` that an executor serves at `POST /v1/rpc` and a brain calls with a hand token. Its shapes, its errors, the `Authentication` middleware and the `Caller` live beside it.
- `src/hand-client.ts`: `HandClient`, the typed client of `HandApi.Rpcs` (`make`, `Client`) and the RPC `path`.
- `src/hand-token.ts`: the token that lets one brain use the executor of one hand (`HandToken.Claims`). Its `typ` stays `environment`, the value that executors already check.
- `src/signature.ts`: Ed25519 keys, their variables (`ENVIRONMENT_KEYS` for Ren, `ENVIRONMENT_PUBLIC_KEYS` for executors), `sign`, `verify` and `generate`. Only Ren holds the private key; brains and executors verify with public keys, so a brain that can read its own files still cannot sign.
- `src/signal.ts`: the signal names a process can get or exit by.

## Notes

- The Hand API is RPC, not `HttpApi`: it is not in OpenAPI and has no HTTP statuses. Its one path is `/v1/rpc`. An executor checks the hand token on the HTTP request before the RPC server decodes a payload; every RPC declares `UnauthorizedError` through the `Authentication` middleware. `HandClient.make` maps an HTTP 401 to that typed error after one retry with the token read again. Each unary call has a time limit (`answerWithin`); a call that ends without an answer calls `onNoAnswer`.
- Both sides build on the same value: the executor with `RpcServer` and a brain with `HandClient.make`. A change here changes both.
- A brain and an executor deploy separately, so a change must work with the previous version on the other side.

## Dependencies

`@ren/schema`, `effect`, `jose`.

## Commands

```sh
bun run test
bun typecheck
bun run keys [id]   # print a new Ed25519 key pair for development
```
