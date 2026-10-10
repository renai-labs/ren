# @ren/core

Domain services and layers. Everything Ren does, without HTTP.

## What belongs here

- One module per domain (`pod.ts`, `agent.ts`, …), each exporting a `Service`, its `Interface` and a `layer`.
- Orchestration across domains.

## What does not

- Endpoint definitions (`@ren/protocol`) or handlers (`@ren/server`).
- Table definitions (`@ren/db`).

## Dependencies

`@ren/schema`, `@ren/db`, `@ren/util`, `effect`.

## Notes

Tests use `testEffect(layer)` from `test/lib/effect.ts`. It provides `TestClock` and `TestConsole` and fails any test that makes a non-loopback network request.

## Commands

```sh
bun run test
bun typecheck
```
