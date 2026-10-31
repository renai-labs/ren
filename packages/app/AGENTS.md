# @ren/app

The product SPA and its web host, built from shadcn's components in `@ren/ui`. Desktop and mobile hosts will import it through a dedicated entry point and supply their own `Platform`. Load the `react`, `interface` and `shadcn` skills before writing components.

## Structure

- `src/main.tsx`: the web host. It creates the web `Platform`, builds the runtime with `Runtime.make(platform)` and mounts `App`.
- `src/app.tsx`: the providers (`Platform`, `Theme`, `Tooltip`, `QueryClient`, `Router`, the `sonner` toaster).
- `src/platform/`: the `Platform` type, its context and the web implementation. Only this directory touches browser storage, network primitives, notifications and window APIs.
- `src/routes/`: TanStack Router file routes. A route declares its loader, guard, search-param schema and pending and error components, then composes feature components. Keep logic out of routes.
- `src/features/<domain>/`: product UI for one backend domain (components, query and mutation hooks, forms). Features never import each other; routes compose them. Each section of a page loads its own data; there is no page-level hook that returns a page object.
- `src/components/`: app-wide compositions used by several features, such as the shell, the sidebars, the `Page` frame (`page.tsx`) and the theme provider.
- `src/lib/`: the runtime (query client, API factory, auth client, router), preferences and the chat runtime. This is where effects and subscriptions live.

## Conventions

- Compose `@ren/ui`, as shadcn apps do: use the variants and sizes `packages/ui/VARIANTS.md` lists, and pass `className` for layout and one-off looks at the call site. A look that repeats belongs in `@ren/ui` or a shared composition in `src/components`.
- Import icons from `@tabler/icons-react` and size them with the part they sit in or a `size-*` class.
- Server data comes from the generated query options in `@ren/client/react`. Route loaders start the fetches without awaiting them, with `Loader.start(queryClient.query(options))`, and the page reads them with `useQuery` or `useSuspenseQuery`, drawing skeletons in its `Page` frame while they are pending. Build the query options from `context.api`, the `RenQuery` factory in the router context; components read it with `RouterContext.useRouterContext()`.
- The boot loader (`AppBoot`) is the pending component of `_authed`, whose `beforeLoad` reads `session` and `me` from the cache, so it shows on the first load and never on a navigation. A route that waits declares its page's skeleton (`PageSkeleton`) as its `pendingComponent`.
- A generated mutation invalidates its own resource group when it succeeds, through the `MutationCache` in `src/lib/runtime.ts`, and `mutateAsync` resolves after the active queries refetch. When a mutation changes another resource, add that group to `invalidates` there instead of invalidating in the feature. Invalidate by hand only after calls that are not generated mutations, such as Better Auth and `@ren/chat`, with an `ast-grep-ignore: no-manual-invalidation` comment that names the call.
- A detail route's query seeds from the cached lists with `Seed.fromList`, so a page opened from a list renders without waiting for a fetch.
- In development, `LayoutShift.watch` logs every layout shift the user did not cause. Fix each one.
- State lives in one place:
  - Server data lives in TanStack Query.
  - Live chat state lives in `@ren/chat` atoms, read through `@ren/chat/react`; `useChatCacheBridge` writes a live title and status into the query cache.
  - Only `features/session/chat-view.ts` reads the whole chat state during render. Components take its narrow values, never `ChatState.State`, so streaming doesn't re-render them.
  - Anything shareable or restorable (filters, tabs, open panels, selection) lives in the URL as search params validated with Effect Schema.
  - Everything else lives in the component that owns it.
- Auth goes through `better-auth/client` in `src/lib/auth.ts`. The session is a query (`sessionOptions(auth)`), guarded in `beforeLoad`.
- Persist client-side settings with `Preference.make(key, schema, fallback)`. Keys carry a version (`theme.v1`); bump it when the shape changes.
- Forms keep their values in component state and use shadcn's `Field` parts, with the error under the field and the submit button disabled while saving.
- Toasts go through `toast` from `@ren/ui/sonner`.
- Host capabilities come from `usePlatform()`. Check optional members before using them, because each host implements a different set. Keyboard shortcuts go through `Keyboard.useKeyDown`, file drops through `FileDrop.use`, and leaving the app through `platform.redirect`.

## Accepted exceptions

- `features/session/use-chat.ts` (`useChat`) returns one object for a chat: the route's chat page and the task page's session sheet both render a chat from it, and its sections take narrow values from it. It reads the chat state through `useView` from `chat-view.ts`.
- `lib/use-schedules.ts` (`useSchedules`) returns the list, filters and sheet state shared by the Scheduled page and a space's Scheduled tab.
- Task list, task detail and task activity refresh every 5 seconds (`refreshEvery` in `lib/tasks.ts`), as main does, until tasks have a realtime subscription.

## Testing

- This package has no unit or component tests. Do not add any.
- Cover user flows with Playwright in `packages/e2e`.
