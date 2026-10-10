# @ren/httpapi-codegen

Build-time source generation for domain-oriented Promise and Effect APIs derived directly from `HttpApi` and Effect Schema contracts.

The package is private. Its tests are the executable specification for the generator. It must remain independent of Ren domain packages (`core`, `db`, `server`) and use synthetic `HttpApi` fixtures.

## What belongs here

- The generic `HttpApi` → client compiler and emitters.
- Tests with synthetic fixtures.

## What does not

- Ren endpoints or schemas. Those live in `@ren/protocol` and `@ren/schema`.
- Generated Ren clients. Those live in `@ren/client`.

## Settled rules

- Reflect one authoritative `HttpApi` into a shared contract with `compile(Api)`.
- Emit clients independently with `emitPromise(contract)` and `emitEffect(contract)`.
- Give each emitter its own public type projection; the shared contract, not a generated type package, is the common source.
- Generate a rich Effect client with decoded Effect-native values, runtime schemas, preserved transformations, and `HttpApiClient`.
- Generate a zero-Effect Promise client with structural wire-oriented values, direct `fetch`, and syntax parsing without runtime structural validation.
- Keep the Promise surface domain-oriented: methods return unwrapped values and reject with tagged declared errors or `ClientError`.
- Return Promise streams as lazy `AsyncIterable` values and Effect streams as `Stream` values. Neither runtime reconnects automatically.
- Flatten path, query, header, and struct payload fields into one input object.
- Represent every non-struct payload as one required `payload` input field and send that value as the request body directly.
- Reject an opaque `payload` field when its name collides with a path, query, or header field.
- Reject duplicate field names across input channels.
- Emit no method argument for zero fields, an optional object when every field is optional, and a required object when any field is required.
- Unwrap exact `{ data: A }` success envelopes.
- Map no-content success to `void`.
- Preserve other single success values.
- Reject ambiguous multiple-success contracts.
- Expose streaming success as `Stream`, not `Effect<Stream>`.
- Reject schemas whose wire/domain transformation cannot be generated exactly.
- Map transport, unexpected-status, and response-decoding failures to one stable generated `ClientError`.
- Commit generated source for review; CI regenerates and fails when the worktree changes.
- Track generated files in `.httpapi-codegen.json` so regeneration removes only stale files previously owned by the generator.

## Commands

```sh
bun run test
bun typecheck
```
