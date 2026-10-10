# @ren/e2e

End-to-end tests across server, client, CLI and app (Playwright).

## What belongs here

- Flows that cross package boundaries: API through the generated client, CLI against a live server, and app flows in a browser.

## What does not

- Unit tests. Those live in each package's `test/` directory.

## Dependencies

Any package, test-only.

## Notes

Playwright runs specs under Node, so use `node:` APIs instead of `Bun.*` in `tests/`.

## Commands

```sh
bun run test   # starts the server on E2E_PORT (default 4010)
bun typecheck
```
