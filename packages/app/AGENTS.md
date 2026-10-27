# @ren/app

Ren's web app: stock shadcn components (style `base-nova`, Base UI) with Ren's dark theme, on Ren's real API. Served at `/app/`. The plan it follows is `docs/data-layer-plan.md`.

## Rules

- Match ren-v2's backend (`packages/schema`). An organization has spaces; chats (sessions) and tasks belong to a space. There are no projects or teams. Pages: chats, Spaces (overview, members, apps, keys, scheduled, factory), Tasks (list and detail), Scheduled, Marketplace, settings (Personal: Preferences, Credentials with its Apps and Keys tabs; Organization: General, Members, Providers). The UI calls loose credentials "Keys"; the API names stay as they are.
- All data comes from the API. No mock data, no mock mode, no MSW.
- Data layer (see the plan for the reasons):
  - Server data: TanStack Query with the generated `api` options from `@ren/client/react` (`src/lib/api.ts`). Compose at the call site; don't wrap a single query or mutation in a hook. Invalidation is global (`MutationCache`, keyed by the mutation key; `meta.invalidates` for other resources).
  - Live chat: `@ren/chat` (`ChatReact`), bridged into the Query cache in `src/lib/chat.ts`.
  - URL state first (filters, tabs, pages), then server, chat, component state; Zustand (`src/stores/ui.ts`) only for client state shared far apart or kept across reloads. Export hooks and module-level actions, never the store.
  - Routes (`src/router.tsx`) prefetch in loaders without awaiting; pages read with `useSuspenseQuery` for data the first paint needs, so nothing pops in. Each page renders from one page hook (`src/routes/<page>/use-<page>-page.ts`).
  - React Compiler is on: no hand-written `useMemo`, `useCallback` or `memo`. No effects to sync state.
- No layout shift: one `Page` frame, fixed row heights, skeletons in the same frame, `tabular-nums` for changing numbers. The dev build logs any shift to the console (`src/lib/layout-shift.ts`); fix it before shipping.
- Lists are paginated with `ListPagination` (25 rows, `?page=`), except Tasks (everything loads, grouped on screen, as Linear) and the sidebar's chats (load as you scroll).
- Keep shadcn's component API: don't rename props, variants or parts. A look that is the same everywhere in Ren is a small class change in the component file, listed under "Changes to the component" in its `.md`. A one-off look is a `className` at the call site.
- Use only the variants in `VARIANTS.md`. Restyle with `className` at the call site, prefer a shared Ren piece in `src/components/ren` when the override repeats, and list every override in `VARIANTS.md`.
- Every component in `src/components/ui` has a `<name>.md` beside it that says, in plain English, what changed compared with stock shadcn. After `shadcn add`, run `python3 scripts/component-notes.py`. Remove a component and its note when nothing uses it.
- Chat is built from shadcn's AI Elements patterns (`src/components/ren/chat/`): read the pattern's `.md` (for example `https://ui.shadcn.com/docs/ai-elements/base/tool.md`) and build it from shadcn components, mapping `@ren/chat`'s rows instead of the AI SDK. The chat keeps Ren's own look where the patterns differ.
- Ren's theme lives in `src/index.css`: Ren's light values on `:root` and dark values on `.dark`, on shadcn's standard variables, Ren's radius scale (`sm` 4, `md`/`lg` 8, `xl` 12, `2xl` 16), SF Pro and IBM Plex Mono. The theme (System, Light, Dark; default Dark) lives in the UI store; `ThemeSync` sets the `dark` class, and a script in `index.html` applies it before the app loads.
- Icons are Tabler (`iconLibrary: "tabler"` in `components.json`).

## Skills

- `shadcn` (`.claude/skills/shadcn`, `.agents/skills/shadcn`): adding and composing components, AI Elements patterns, `shadcn diff`. Run it from `packages/app`, where `components.json` lives.
- `emil-design-eng`: polish and motion. Animate only `transform` and `opacity`, under 300ms, `ease-out`; nothing on keyboard-driven or very frequent actions; respect `prefers-reduced-motion`. Review each page and chat pattern with it.

## Run

- From the repo root: `docker compose up -d postgres celld`, `bun run dev` (API on 4000), `bun run dev:app` (app on 5173 at `/app/`).
- `bun run typecheck` here, `bun run lint` from the repo root.
