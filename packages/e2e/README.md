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

`script/serve.ts` creates an isolated database, migrates it and starts three processes, then drops the database on shutdown:

- The server on `E2E_PORT` (default 4010). API and CLI specs call it directly through `serverURL`.
- The app on `E2E_APP_PORT` (default 4011), proxying the API routes to the server. It is Playwright's `baseURL`, so the browser and Better Auth share one origin.
- A mailbox on `E2E_MAILBOX_PORT` (default 4012). `GET /?to=<email>` returns the last email the server logged for that address, so specs read codes and links from real emails.

## Commands

```sh
bun run test   # needs `docker compose up -d`
bun typecheck
```
