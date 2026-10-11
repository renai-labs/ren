# @ren/app

The product SPA and its web host. Desktop and mobile hosts will import it through a dedicated entry point and supply their own `Platform`. Load the `react` and `interface` skills before writing components.

## Structure

- `src/main.tsx`: the web host. It creates the web `Platform`, builds the runtime with `Runtime.make(platform)` and mounts `App`.
- `src/app.tsx`: the providers (`Platform`, `Theme`, `QueryClient`, `Router`).
- `src/platform/`: the `Platform` type, its context and the web implementation. Only this directory touches browser storage, network primitives, notifications and window APIs.
- `src/routes/`: TanStack Router file routes. A route declares its loader, guard, search-param schema and pending and error components, then composes feature components. Keep logic out of routes.
- `src/features/<domain>/`: product UI for one backend domain (components, query and mutation hooks, forms). Features never import each other; routes compose them.
- `src/components/`: app-wide compositions used by several features, such as the shell frame and navigation.
- `src/lib/`: the runtime (query client, API factory, auth client, router), preferences and the realtime sync layer. This is where effects and subscriptions live.

## Conventions

- Compose `@ren/ui`. App code only lays components out, with the layout classes lint allows. When something visual is missing, add or extend a component in `@ren/ui`.
- Server data comes from the generated query options in `@ren/client/react`, preloaded in route loaders with `queryClient.query(options)`. Build the query options from `context.api`, the `RenQuery` factory in the router context.
- Mutations invalidate or update the queries they affect.
- Realtime events from the sync layer write into the query cache.
- State lives in one place:
  - Server data lives in TanStack Query.
  - Anything shareable or restorable (filters, tabs, open panels, selection) lives in the URL as search params validated with Effect Schema.
  - Everything else lives in the component that owns it.
- Auth goes through `better-auth/client` in `src/lib/auth.ts`. The session is a query (`Auth.sessionOptions`), guarded in `beforeLoad`.
- Persist client-side settings with `Preference.make(key, schema, fallback)`. Keys carry a version (`theme.v1`); bump it when the shape changes.
- Use Ren's own endpoints (`me`, invitations) through `@ren/client`.
- Forms use the form hook from `@ren/ui/form`, validated with the same Effect Schema as the request body.
- Host capabilities come from `usePlatform()`. Check optional members before using them, because each host implements a different set.

## Testing

- Test components with `bun test` against real providers.
- Cover user flows with Playwright in `packages/e2e`.
