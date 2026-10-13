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

## Hosting

The web app is served under `/app/` (Vite `base`, router `basepath`) and calls the API on its own origin, with credentials. Set `VITE_REN_API_URL` at build time (for example `https://api.useren.ai`); without it the app uses its own origin. In development it defaults to `http://localhost:4000`.

## Commands

```sh
bun run dev   # serves http://localhost:5173/app/, calls the API at VITE_REN_API_URL (default http://localhost:4000)
bun run build
bun run test
bun typecheck
```
