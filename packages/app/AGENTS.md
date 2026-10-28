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

- Compose `@ren/ui`, as shadcn apps do: use its variants and sizes, and pass `className` for layout and one-off looks at the call site. A look that repeats belongs in `@ren/ui`, in the component or a shared composition.
- Import icons from `@tabler/icons-react`, as shadcn apps do, and size them with the part they sit in or a `size-*` class. Older code still uses `@ren/ui/icon`'s glyphs; use those only for marks Tabler lacks, such as Linear.
- Server data comes from the generated query options in `@ren/client/react`. Route loaders start the fetches without awaiting them, with `Loader.start(queryClient.query(options))`, and the page reads them with `useQuery`, drawing skeletons in its `Page` frame while they are pending (the `react` skill has the rules). Build the query options from `context.api`, the `RenQuery` factory in the router context.
- The boot loader (`AppBoot`) is the pending component of `_authed` only, whose `beforeLoad` reads `session` and `me` from the cache (`staleTime: "static"`), so it shows on the first load and never on a navigation. A route that waits (a lazy component or an awaited loader) declares its page's skeleton as its `pendingComponent`; every other route draws its skeletons inside the page.
- A generated mutation invalidates its own resource group when it succeeds, through the `MutationCache` in `src/lib/runtime.ts`, and `mutateAsync` resolves after the active queries refetch. When a mutation changes another resource, add that group to `invalidates` there instead of invalidating in the feature. Invalidate by hand only after calls that are not generated mutations, such as Better Auth and `@ren/chat`, with an `ast-grep-ignore: no-manual-invalidation` comment that names the call.
- A detail route's loader seeds its query from the cached lists with `Seed.fromList`, so a page opened from a list renders without waiting for a fetch.
- In development, `LayoutShift.watch` logs every layout shift the user did not cause. Fix each one.
- Realtime events from the sync layer write into the query cache.
- State lives in one place:
  - Server data lives in TanStack Query.
  - Live chat state lives in `@ren/chat` atoms, read through `@ren/chat/react`.
  - Only `features/session/chat-view.ts` reads the whole chat state during render. Components take its narrow values, never `ChatState.State`, so streaming doesn't re-render them.
  - Anything shareable or restorable (filters, tabs, open panels, selection) lives in the URL as search params validated with Effect Schema.
  - Everything else lives in the component that owns it.
- Auth goes through `better-auth/client` in `src/lib/auth.ts`. The session is a query (`Auth.sessionOptions`), guarded in `beforeLoad`.
- Persist client-side settings with `Preference.make(key, schema, fallback)`. Keys carry a version (`theme.v1`); bump it when the shape changes.
- Use Ren's own endpoints (`me`, invitations) through `@ren/client`.
- Forms use the form hook from `@ren/ui/form`, validated with the same Effect Schema as the request body.
- Host capabilities come from `usePlatform()`. Check optional members before using them, because each host implements a different set.

## Testing

- This package has no unit or component tests. Do not add any.
- Cover user flows with Playwright in `packages/e2e`.
