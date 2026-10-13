# @ren/app

The Ren product web app (Vite + React).

## What belongs here

- Routes, screens and client-side state.
- API access through `@ren/client`.

## What does not

- Reusable components (`@ren/ui`).
- Imports from `core`, `db` or `server`.

## Dependencies

`@ren/client`, `@ren/ui`, `react`, `react-dom`.

## Commands

```sh
bun run dev   # proxies the API routes to http://localhost:4000
bun run build
bun run test
bun typecheck
```
