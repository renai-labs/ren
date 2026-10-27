# Plan: ren-shadcn as ren-v2's frontend

ren-shadcn becomes ren-v2's only frontend.

- ren-v2's old frontend (`packages/app`, `packages/ui`, `packages/storybook`) is deleted, and ren-shadcn takes its place as `packages/app` (`@ren/app`).
- All data comes from the real API. The mock (`mock.json`, its helpers, any mock mode) is removed completely.
- The chat UI is rebuilt from shadcn's AI Elements: patterns built from shadcn components (Base UI), with no AI SDK.
- Work is done with two agent skills: shadcn's `shadcn` skill and Emil Kowalski's `emil-design-eng` (see "Skills").
- Long lists are paginated with shadcn's Pagination.
- Switching pages never shifts the layout.

| Concern | Library |
| --- | --- |
| Routing, URL state, prefetching | TanStack Router |
| Server data (everything except live chat) | TanStack Query + `@ren/client/react` (generated `queryOptions`/`mutationOptions`) |
| Live chat (timeline, status, sending) | `@ren/chat` (`ChatReact` hooks) |
| Client-only shared state | Zustand |
| Chat UI | shadcn AI Elements patterns, built from shadcn components (`message-scroller`, `message`, `bubble`, `trace`, `code-block`, `attachment`, `questionnaire`, `input-group`) |
| How agents build it | `shadcn` skill (components, patterns, CLI) + `emil-design-eng` skill (polish, motion, review) |
| Everything else | React 19 + React Compiler |

## Research summary

These are the patterns the plan follows, and where each comes from.

**TanStack Query** (TkDodo, TanStack maintainer: "Creating Query Abstractions", "The Query Options API", "Practical React Query")
- `queryOptions` is the main abstraction, not custom hooks that wrap `useQuery`. Hooks can't run in route loaders or event handlers, and a wrapper hook locks you into `useQuery` vs `useSuspenseQuery`. `@ren/client/react` already generates these options for every endpoint, so we write none.
- The best abstractions aren't configurable. Compose at the call site: `useSuspenseQuery({ ...api.task.get.queryOptions(input), select })`.
- Keep server state and client state separate. Never copy query data into `useState` or a store. The one exception is a form draft initialised from it.
- Treat the query key like a dependency array: filters go into the input, so they become part of the key automatically.
- Use `select` for derived slices. Stable `select` functions avoid re-running; the React Compiler makes inline ones stable.

**TanStack Router + Query** (TkDodo, "TanStack Router and Query")
- Put `queryClient` in the router context, and use `createRootRouteWithContext`.
- Treat a loader as an event handler: it only starts fetches (`prefetchQuery`), with no `await` and no return. Components read with `useSuspenseQuery` for blocking data and `useQuery` for deferred data.
- Never use `useLoaderData` with Query. Without an observer, the query is inactive: no refetch on focus, no refetch on invalidation, and it can be garbage-collected.
- `defaultPreload: "intent"` gives prefetch-on-hover. Set `defaultPreloadStaleTime: 0` so only Query decides about caching.
- Set `defaultPendingComponent` and `defaultErrorComponent` once, so pages only handle the success case.

**Mutations** (TkDodo, "Automatic Query Invalidation after Mutations", "Mastering Mutations")
- Invalidate in one global `MutationCache.onSuccess` instead of in every `useMutation`. Invalidation refetches only active queries and marks the rest stale, so it's cheap.
- Tie invalidation to the `mutationKey`. Our generated keys already line up: mutation `["task", "update"]` → invalidate `["task"]`, which covers `["task", "list", …]` and `["task", "get", …]`. Use `meta.invalidates` for effects on other resources.
- For optimistic UI, render `mutation.variables` while the mutation is pending, and touch the cache only where a list must reorder.
- Await an invalidation only when the UI must wait for it.

**Zustand** (Zustand docs: "Flux inspired practice", "Practice with no store actions", "Prevent rerenders with useShallow"; TkDodo, "Working with Zustand")
- Don't export the store; export only hooks, so nobody can subscribe to the whole store.
- Use atomic selectors, one value per hook. Use `useShallow` only when a selector builds an array or object.
- Write actions as module-level functions (`useStore.setState`): they need no hook, work outside React, and keep `persist` simple. Name them as events (`openNewTask`), not setters.
- Keep it small. Most state is URL or server state; Zustand holds the rest.

**React** (react.dev: "You Might Not Need an Effect"; React Compiler)
- Derive during render; don't sync state with `useEffect`. Reset with `key`. Do the work in event handlers.
- With the React Compiler on, there's no hand-written `useMemo`, `useCallback` or `memo`. ren-v2's own app uses the same setup.

## Where state lives

Decide in this order, and take the first that fits:

1. **URL** (path params, search params): which page and item, filters, tabs, sort, settings section. It's shareable and survives a reload.
2. **Server** (TanStack Query via `api`): anything the backend owns.
3. **Live chat** (`@ren/chat`): the timeline, connection status, sending, queue, permissions.
4. **Component** (`useState`): short-lived and used by one component, such as an input's text or a popover being open.
5. **Zustand**: client-only state shared by distant components or kept across reloads. Examples: task display options, chat detail level, the New task dialog opened from both a shortcut and a button.

## Hooks: one per primitive or page

| Kind | Where | What it does | Example |
| --- | --- | --- | --- |
| **Query primitive** | generated `api` | Options for one endpoint. Not a hook, so it also works in loaders. | `api.task.list.queryOptions(input)` |
| **Primitive hook** | `src/hooks/use-<primitive>.ts` | A shared read used by two or more pages, plus its lookups. Thin: `useSuspenseQuery({ ...options, select })`. | `useMe()`, `useOrganization()`, `useSpaces()`, `useMembers()`, `useAgents()`, `useLabels(spaceId)`, `useModels()` |
| **Page hook** | `src/routes/<page>/use-<page>-page.ts` | The only place a page reads URL, server, chat and store state. Returns a view model: data, derived values and event handlers. | `useTasksPage()`, `useTaskPage(id)`, `useChatPage(id)` |
| **Store hooks** | `src/stores/ui.ts` | One atomic selector hook per value, plus module-level actions. | `useTaskDisplay()`, `groupTasksBy("status")` |

Rules:
- A page component only renders: `const page = useTasksPage()`, then JSX.
- No wrapper hook around a single generated mutation. Use `useMutation(api.task.update.mutationOptions())` inside the page hook, and invalidation happens globally.
- Components in `components/ren` (including `ren/chat`) take props. A leaf that needs a shared primitive (for example `PersonAvatar` resolving a member) may call the primitive hook instead of receiving it through many layers. It's deduplicated, so there's no extra request.
- A hook is created only when something uses it twice, or when it is a page's hook.

## Code shape

```ts
// src/lib/api.ts
export const client = Ren.make({ baseUrl: "/api" })
export const api = RenQuery.make(client)

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
  mutationCache: new MutationCache({
    onSuccess: (_data, _variables, _result, mutation) => {
      // ["task", "update"] → every ["task", …] query; meta.invalidates adds other resources.
      const keys = [mutation.options.mutationKey?.slice(0, 1), ...(mutation.meta?.invalidates ?? [])]
      for (const queryKey of keys) if (queryKey) void queryClient.invalidateQueries({ queryKey })
    },
  }),
})
```

```ts
// src/router.tsx: a page route
const tasksRoute = createRoute({
  getParentRoute: () => appLayout,
  path: "tasks",
  validateSearch: TaskSearch,           // filters live in the URL
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {      // event handler: start fetching, return nothing
    void context.queryClient.prefetchQuery(api.task.list.queryOptions(taskListInput(deps)))
  },
  component: TasksPage,
})
```

```ts
// src/routes/tasks/use-tasks-page.ts
export function useTasksPage() {
  const search = tasksRoute.useSearch()
  const navigate = tasksRoute.useNavigate()
  const { data: tasks } = useSuspenseQuery(api.task.list.queryOptions(taskListInput(search)))
  const display = useTaskDisplay()
  const update = useMutation(api.task.update.mutationOptions())

  return {
    groups: groupTasks(tasks.items, display.groupBy),
    filters: search,
    filter: (next: Partial<TaskSearch>) => navigate({ search: (previous) => ({ ...previous, ...next }) }),
    setStatus: (id: string, status: TaskStatus) => update.mutate({ id, status }),
    pendingStatus: update.isPending ? update.variables : undefined, // optimistic, UI-level
  }
}
```

```ts
// src/stores/ui.ts
const useUi = create<Ui>()(persist(() => initial, { name: "ren.ui", version: 1, partialize: ({ newTaskOpen, ...kept }) => kept }))

export const useTaskDisplay = () => useUi((state) => state.taskDisplay)
export const useNewTaskOpen = () => useUi((state) => state.newTaskOpen)

export const groupTasksBy = (groupBy: TaskGroup) =>
  useUi.setState((state) => ({ taskDisplay: { ...state.taskDisplay, groupBy } }))
export const openNewTask = () => useUi.setState({ newTaskOpen: true })
```

```tsx
// src/routes/chat/use-chat-page.ts and the transcript
export function useChatPage(sessionId: Session.ID) {
  const { status, timeline } = ChatReact.useSession(sessionId) // timeline: AsyncResult<{ rows }>, unwrapped here
  const send = ChatReact.useAction(sessionId, (session, text: string) => session.prompt(/* … */))
  const interrupt = ChatReact.useAction(sessionId, (session) => session.interrupt)
  return { status, timeline, send, interrupt }
}

// src/components/ren/chat/transcript.tsx: the Chat pattern
<MessageScrollerProvider autoScroll>
  <MessageScroller>
    <MessageScrollerViewport>
      <MessageScrollerContent>
        {rows.map((row) => <TranscriptRow key={TimelineRow.key(row)} row={row} />)}
      </MessageScrollerContent>
    </MessageScrollerViewport>
    <MessageScrollerButton />
  </MessageScroller>
</MessageScrollerProvider>
```

`@ren/chat` reuses row objects that didn't change (`Projection.reuse`). With the compiler memoizing components, only the row that's streaming re-renders.

## Cache

The cache has one owner per kind of data. Nothing is cached twice.

| Data | Cached by | Kept | Fresh until |
| --- | --- | --- | --- |
| Server data | TanStack Query, in memory | 5 min after the last user (`gcTime`) | its `staleTime` (below), a mutation, window focus, reconnect, or a chat event |
| Live chat | `@ren/chat` | 1 min after leaving a chat (session idle TTL), then reopened from the server | always live while open |
| Unsent chat messages | `@ren/chat` outbox, `localStorage` | until the agent accepts them | — |
| Preferences | Zustand `persist`, `localStorage` | until changed; `version` drops old shapes | — |
| Route data | nothing: router caching off (`defaultPreloadStaleTime: 0`) | — | — |
| HTTP | nothing: the API sends no cache headers; Vite's hashed assets cache themselves | — | — |

**Freshness per resource.** Set once, keyed by the generated key prefixes:

```ts
queryClient.setQueryDefaults(["me"], { staleTime: Infinity })                    // changes only through our own mutations
queryClient.setQueryDefaults(["organization-settings"], { staleTime: Infinity })
queryClient.setQueryDefaults(["chat", "models"], { staleTime: 10 * 60_000 })
queryClient.setQueryDefaults(["task"], { staleTime: 30_000 })                    // agents change tasks in the background
queryClient.setQueryDefaults(["session"], { staleTime: 30_000 })
// everything else: the 60s default
```

Even with `Infinity`, an invalidation still refetches. Only `staleTime: "static"` ignores invalidation, and we don't use it.

**How the cache stays correct**
- **Our mutations:** the global `MutationCache` invalidates the mutated resource (`["task", "update"]` → `["task"]`), and `meta.invalidates` covers other resources. Active queries refetch now; inactive ones refetch when next used.
- **Agent changes:** window focus and reconnect refetch stale active queries (Query's defaults stay on). Shorter `staleTime` covers tasks and sessions.
- **Chat events:** when `@ren/chat` reports a session's new title or status, we write it into the cached sidebar list (all loaded pages) and `session.get` data with `setQueriesData`, without refetching. One bridge in `src/lib/chat.ts` does this, so pages don't.
- **Organization switch and sign-out:** the generated keys don't include the organization, so we `queryClient.clear()` and reset the chat registry. Otherwise one organization's data could show in another.

**Instant detail pages (seeding).** A task, space or session opened from a list renders at once from the list's copy, then refreshes. List items and details have the same type (`TaskInfo`, `SpaceInfo`, `SessionInfo`), so this is safe. It's the "pull" approach (TkDodo, "Seeding the Query Cache"): `initialData` reads the item from any cached list, and `initialDataUpdatedAt` uses that list's fetch time, so staleness stays honest. This lives in one helper (`src/lib/cache.ts`), used by the three detail options. For sessions, it reads the sidebar's loaded pages.

**Prefetching.** Hovering a link runs the route loader (`defaultPreload: "intent"`), which calls `prefetchQuery`. That respects `staleTime`, so fresh data isn't fetched again.

**Decided: no cache across reloads for now.** `PersistQueryClientProvider` could restore the sidebar (spaces, sessions, `me`) instantly on reload. It needs a `buster` (app version), `gcTime` ≥ `maxAge`, persisting only chosen queries, and wiping on sign-out, and it puts private data on disk. We add it later only if reloads feel slow.

## Chat UI: shadcn AI Elements

shadcn's [AI Elements](https://ui.shadcn.com/docs/ai-elements) are patterns, not a package. Each one is a composition of shadcn components that we write in `src/components/ren/chat/`, following its docs page. Every page also has a Markdown version for agents, for example `https://ui.shadcn.com/docs/ai-elements/base/tool.md`.

- They're built on Base UI and use our icon library (Tabler).
- They need no AI SDK. Where the docs map AI SDK parts to a pattern, we map `@ren/chat`'s rows and parts instead.
- These aren't the older AI SDK Elements (elements.ai-sdk.dev).

**Components:**
- We keep `message-scroller`, `message`, `bubble`, `marker` and `input-group`; the Chat and Message patterns are built on them. Marker is shadcn's inline status, system note or labeled separator in a conversation.
- We add `trace`, `code-block`, `attachment` and `questionnaire` with `shadcn add`. Each gets its `.md` note (`scripts/component-notes.py`).
- Markdown in replies renders with Streamdown, and fenced code goes to Code Block, as the Message pattern shows.

| `@ren/chat` | Pattern |
| --- | --- |
| Timeline | Chat (Message Scroller; the person's turn is the scroll anchor, `autoScroll` follows the reply) |
| User message, assistant text | Message (Bubble for the person, Markdown for the reply, actions under it) |
| Thinking / reasoning | Reasoning (Trace; opens while thinking, closes when done) |
| Tool calls | Tool (Trace + Code Block); `running`/`completed`/`failed` → the Trace status |
| Failed tool with a stack | Stack Trace |
| Shell and command tools | Terminal |
| Grouped reads, context and search steps | Chain of Thought |
| Sub-agent tool, child sessions | Subagent |
| The agent's todo list | Queue |
| The agent's plan | Plan |
| Session tasks | Task |
| Permission request | Confirmation (an Item outside the Trace) |
| Forms, the question tool | Questionnaire |
| Revert | Checkpoint |
| Token usage | Context |
| Changed files | File Tree |
| Web search results, links | Sources, Inline Citation |
| Working | Marker with a Spinner and the `shimmer` util ("Thinking…") |
| Notices, errors, retries, compaction, turn dividers | Marker (system note, status or labeled separator) |
| Composer | Prompt Input (Input Group + Attachment + Dropdown Menu) |
| Model and effort | Model Selector |

Anything with no pattern or component isn't shown: the diff view, @-mentions, composer history and the queued-message inbox.

## Skills

Two agent skills are installed in ren-v2 and used for all UI work in this plan.

**Install** (project level, copied in so they're committed and reviewed):

```sh
npx skills add shadcn/ui --skill shadcn -a opencode -a pi -a claude-code --copy -y
npx skills add emilkowalski/skills --skill emil-design-eng -a opencode -a pi -a claude-code --copy -y
```

OpenCode and Pi read `.agents/skills/`, and Claude Code reads `.claude/skills/`. ren-v2's existing skills in `.opencode/skills/` stay where they are.

**`shadcn`** (shadcn/ui's skill, [docs](https://ui.shadcn.com/docs/skills)):
- **What it does:** it reads `components.json` with `shadcn info --json`, so the agent knows the base library (Base UI), icon library (Tabler), aliases and the components already installed. It uses `shadcn docs`, `shadcn search`, `shadcn view` and `shadcn add` before writing code, and follows shadcn's rules (`FieldGroup` for forms, `ToggleGroup` for option sets, semantic colors, Base UI APIs).
- **Run it from `packages/app`,** where `components.json` lives (or pass `-c packages/app`).
- **Used for:**
  - adding and composing every component;
  - Pagination (`createLink` wrapper) and skeletons;
  - the auth pages (shadcn's login and signup blocks, `input-otp`);
  - every AI Elements pattern (read the pattern's `.md`, then build it);
  - `shadcn diff`, to see how our edited components differ from upstream.
- **Optional:** the shadcn MCP server (`npx shadcn@latest mcp init --client opencode`) for browsing registries.

**`emil-design-eng`** (Emil Kowalski, [skill](https://github.com/emilkowalski/skills/tree/main/skills/emil-design-eng)):
- **What it does:** it covers UI polish, component feel and when and how to animate.
- **Rules we apply:**
  - **When not to animate:** don't animate keyboard-driven or very frequent actions (command palette, list navigation).
  - **Speed:** stay under 300ms, with exits faster than entries.
  - **Easing:** `ease-out` with strong custom curves for enter and exit, never `ease-in`.
  - **What to animate:** only `transform` and `opacity`, never `transition: all`.
  - **Popovers:** they scale from `var(--transform-origin)` (Base UI gives this); modals stay centered. Never `scale(0)`: start at `0.95` plus opacity.
  - **Buttons:** they press to `scale(0.97)` on `:active`.
  - **Tooltips:** skip the delay after the first one opens.
  - **Hover and reduced motion:** hover effects only under `(hover: hover) and (pointer: fine)`, and `prefers-reduced-motion` respected.
  - **Lists and enters:** stagger list entrances by 30–80ms only where they're rare, and use `@starting-style` for enter states.
- **Review:** every page and chat pattern gets a review in its required format, a `Before | After | Why` table, against its checklist before the phase is done.
- **It works with "No layout shift":** motion never animates layout properties, and skeleton-to-content swaps use opacity only.

## Pagination

Every list on a page is paginated with shadcn's `pagination` component (`shadcn add pagination`). That covers tasks, spaces, space members, organization members and invitations, credentials, apps, agents and environment templates.

- **API:** every list endpoint takes `page` (starting at 1) and `pageSize` (at most 100), and returns `{ items, page, pageSize, total }`.
- **URL:** the page is a search param, `?page=2` (validated, defaults to 1). It goes into the query input, so it's part of the query key.
- **Page size:** fixed at 25 rows, set in one place.
- **One Ren piece** (`components/ren/list-pagination.tsx`): `<ListPagination page pageSize total />`, built from shadcn's parts. It shows numbers like `1 … 4 5 6 … 20` using a small pure helper.
  - Links are made router-aware with TanStack Router's `createLink(PaginationLink)`. The shadcn component stays as generated, links navigate without a full reload, and hovering "Next" preloads the next page through the route loader.
- **Switching pages:** `placeholderData: keepPreviousData` keeps the current rows on screen, dimmed with `isPlaceholderData`, until the next page arrives. The list never collapses to a spinner.
- **After a delete empties the last page,** the delete handler moves to the previous page.
- **Not paginated:** pickers and menus (labels, agents, members, models inside selects) load one page of 100, with search where the API supports it.

**Exception: the sidebar's chats load as you scroll.** There are no buttons and no page numbers.
- **Query:** `useSuspenseInfiniteQuery` with one `infiniteQueryOptions` built on `client.session.list({ page, pageSize })`. `getNextPageParam` returns the next page while `page × pageSize < total`.
- **Key:** `["session", "infinite", input]`. It sits under `["session"]`, so session mutations still invalidate it, but it never mixes with the paged `["session", "list", …]` shape.
- **Trigger:** an invisible row at the end of the list. A ref callback attaches an `IntersectionObserver` and removes it in the ref's cleanup (React 19), so no `useEffect`. It loads the next page a little before the end is reached.
- **While loading:** skeleton rows of the same height appear at the bottom, so nothing above them moves.

## No layout shift

Switching pages, tabs or list pages moves nothing that stays on screen. The target is a cumulative layout shift (CLS) of 0.

1. **One fixed frame.** The shell (sidebar + inset) is a layout route that never unmounts. Every page renders inside the same `Page` grid:

   ```
   header    fixed height; the title sits at the same x/y on every page
   toolbar   fixed height; the row is there even when it's empty
   body      the only part that scrolls (overflow-y-auto, scrollbar-gutter: stable)
   footer    fixed height; holds the pagination, reserved even with one page
   ```

   Today `Page` has two layouts: a centered 800px column starting 88px down, and full width starting 24px down. Switching between Spaces and Tasks moves the title. Those become one layout (see open decisions).
2. **The header doesn't wait for data.** Fixed titles come from the route (`staticData`) and render at once. Titles from data (a space's name, a task's title) hold a fixed-height line until they load.
3. **Loading has the same shape.** Each route's `pendingComponent` is that page's skeleton, drawn in the same frame: same header, same toolbar, 25 rows at the fixed row height (44px).
4. **No flashing.** Keep the router's `defaultPendingMs` (1s) so fast loads keep the old page until the new one is ready. Set `defaultPendingMinMs` (500ms) so a skeleton never flickers. With hover prefetch, most navigations are instant.
5. **Lists:** fixed row heights, a fixed page size, `keepPreviousData` when changing pages, and the pagination pinned in the footer.
6. **Text that changes:** `tabular-nums` on counts, page numbers, dates and timers, so their width doesn't change.
7. **Fonts:** preload SF Pro and IBM Plex Mono in `index.html`, so text never re-flows from a fallback font.
8. **Fixed sizes** for avatars, icons and logos (already true).
9. **Overlays** (dialogs, menus, popovers, toasts) are portals and never push content.
10. **Tabs inside a page** (space overview, members, credentials, factory) are child routes. The tab bar belongs to the parent page and stays mounted; only the tab's body swaps.
11. **Scroll:** `scrollRestoration: true`. The body scroll container starts at the top on a new page.

**Check:**
- A dev-only `PerformanceObserver` for `layout-shift` logs any shift to the console.
- An e2e spec walks every page, tab and pagination step, and fails if CLS is above 0.

## Folder layout

```
src/
  main.tsx                 providers: QueryClientProvider, ChatReact.Provider, RouterProvider
  router.tsx               routes: loaders, validateSearch, beforeLoad (auth), default pending/error
  lib/
    api.ts                 client, api, queryClient, per-resource staleTime
    cache.ts               seeding details from lists
    auth.ts                better-auth client, session queryOptions
    chat.ts                ChatAtoms + registry, one per signed-in user; chat → Query cache bridge
    format.ts              initials, dates, role labels (kept from the old src/data helpers)
  hooks/                   primitive hooks: use-me, use-organization, use-spaces, use-members, …
  stores/ui.ts             Zustand
  routes/<page>/           <page>.tsx (render only) + use-<page>-page.ts
  components/
    ui/                    shadcn, unchanged rules
    ren/                   Ren pieces, props in: page.tsx (the fixed frame), list-pagination.tsx, …
    ren/chat/              AI Elements patterns built for Ren: transcript (TimelineRow → patterns), Prompt Input composer
```

## Replacing ren-v2's old frontend

ren-shadcn takes the old app's place: `packages/app`, named `@ren/app`, served at `/app/` (same base path). The root `dev:app` script, the Vite proxy and the e2e config keep working.

**Delete:**
- `packages/app` (the old app)
- `packages/ui` (`@ren/ui`)
- `packages/storybook` (it only covers `@ren/ui`)

**Update in ren-v2:**
- **`oxlint.config.ts`:**
  - Remove the rules that send app code to `@ren/ui`: the bans on `@base-ui`, `@tabler`, `class-variance-authority`/`clsx`/`tailwind-merge`, `sonner` and `date-fns`; the rule limiting app classes to layout; the `packages/ui` block; and story coverage.
  - Exclude `src/components/ui` (shadcn's generated code).
- **`script/ast-grep/rules/*`:** drop the `packages/ui` targets, and keep the app rules that still fit (for example `no-query-key-literal`). Delete `script/oxlint/ren/rules/story-coverage.ts`.
- **`script/generate.ts`:** drop the `packages/ui` tokens step and the old route generator, since the new app defines routes in code.
- **`.github/workflows/test.yml`:** remove "Check generated routes" and the Storybook job.
- **Other config:**
  - `knip.json`: drop the Storybook entry.
  - Root `package.json`: drop `dev:storybook` and the Storybook catalog entries.
  - `.vscode/settings.json`: point the Tailwind path at `packages/app/src/index.css`.
- **`.opencode/skills`:** delete `sync-with-paper` (it writes tokens into `packages/ui`), and rewrite `interface` and `react` for the new app. The `interface` skill points to `emil-design-eng` for polish and motion, and to `shadcn` for components.
- **Root `AGENTS.md`:** "`app` builds on `client`, `chat`, `schema` and `util`" (no `ui`).
- **`packages/e2e/tests/app/*`:** these 15 specs are the acceptance tests. Each is rewritten for the new UI when its page lands; the user journeys stay the same.

**Remove from ren-shadcn:**
- `src/data/` (`mock.json` and its helpers).
- The mock wording in `AGENTS.md` and `README.md`.
- No MSW and no mock mode. The non-mock helpers (`initials`, `formatDate`, `roleLabel`, `modelKey`) move to `src/lib/format.ts`.
- `reference/` (the 11 MB of screenshots) isn't brought into ren-v2.

**Parity: pages the old app has and ren-shadcn doesn't yet.** These must exist before the old app is deleted.
- **Auth:** login (email code, password, Google), signup, verify email, forgot and reset password, OAuth consent (`/consent`), accept invitation (`/invites/accept`), create organization, the organization switcher. Built from shadcn's login and signup blocks, and `input-otp` for codes.
- **Other pages:** Marketplace (`/marketplace`), Settings → Providers, the space Apps tab, the profile and password dialogs.
- **Chat extras:** shell, search, child sessions, permission and form requests.

## Phases

All work happens on one branch in ren-v2 and reaches `main` only through a PR. Each phase ends with typecheck and lint passing and the app running against the local backend. Nothing mock-related is merged.

0. **Replace.**
   - Delete `packages/app`, `packages/ui` and `packages/storybook`, and move ren-shadcn in as `packages/app` (`@ren/app`, base `/app/`).
   - Use the root `catalog:` versions, and `workspace:*` for `@ren/client`, `@ren/chat` and `@ren/schema`.
   - Make the tooling, CI and docs updates above.
   - Install the `shadcn` and `emil-design-eng` skills (see "Skills"), and point to them from `packages/app/AGENTS.md`.
1. **Foundation.**
   - Turn on the React Compiler (`@rolldown/plugin-babel` + `reactCompilerPreset`).
   - Add `lib/api.ts`, and the router context and defaults (`createRootRouteWithContext`, `defaultPreload: "intent"`, `defaultPreloadStaleTime: 0`, `defaultPendingMinMs`, default pending and error components).
   - Add the fixed `Page` frame and `ListPagination`, and the dev-only layout-shift logger.
   - Add `stores/ui.ts`.
2. **Auth and organizations.** Add the better-auth client, all auth pages, the `beforeLoad` redirect, create organization and the switcher. Switching organization runs `queryClient.clear()` and resets the chat registry. Port the e2e specs: login, signup, password reset, invitation, create organization.
3. **Primitives, then pages one at a time:**
   - Add `useMe`, `useOrganization`, `useSpaces`, `useMembers`, `useAgents`, `useLabels`, `useModels`.
   - Then move the pages in this order: sidebar (chats load as you scroll) → spaces → space (overview, members, credentials, factory, apps) → tasks → task → settings (general, members, preferences, credentials, providers, apps) → marketplace → home.
   - Each page gets a loader, a page hook, a skeleton, pagination where it lists things, its e2e spec, and an `emil-design-eng` review. Its `@/data` imports go away, and `src/data/` is deleted at the end of this phase.
4. **Chat.**
   - Add `ChatReact.Provider`.
   - With the `shadcn` skill, add `trace`, `code-block`, `attachment` and `questionnaire`, and build each pattern from its `.md` page in `components/ren/chat/`.
   - Write the transcript and `useChatPage`, and build the composer as Prompt Input + Model Selector.
   - Add shell, search, child sessions and requests.
   - Delete `components/ren/composer.tsx`. Keep `message`, `bubble`, `message-scroller` and `marker`, which the patterns use.
   - Run an `emil-design-eng` review of every pattern.
   - Port the e2e specs: chat, shell, search.
5. **Finish.** Add the layout-shift e2e spec. Update `AGENTS.md` (real API, chat look exception) and `VARIANTS.md`.

## Open decisions

1. **One page width** for the fixed frame: a centered 800px column everywhere, or full width everywhere (as Tasks is today)?
2. **Tasks grouped by status with pagination:** one paged list grouped on screen, or a separate paged list per status group?

Decided:
- The sidebar's chats load as you scroll: no "View all", no button, no pagination.
- No Query cache across reloads for now.
- `reference/` stays out of ren-v2.

## Sources

- TkDodo: [Creating Query Abstractions](https://tkdodo.eu/blog/creating-query-abstractions), [The Query Options API](https://tkdodo.eu/blog/the-query-options-api), [TanStack Router and Query](https://tkdodo.eu/blog/tan-stack-router-and-query), [Automatic Query Invalidation after Mutations](https://tkdodo.eu/blog/automatic-query-invalidation-after-mutations), [Mastering Mutations](https://tkdodo.eu/blog/mastering-mutations-in-react-query), [React Query Selectors, Supercharged](https://tkdodo.eu/blog/react-query-selectors-supercharged), [Practical React Query](https://tkdodo.eu/blog/practical-react-query), [Seeding the Query Cache](https://tkdodo.eu/blog/seeding-the-query-cache), [React Query and Forms](https://tkdodo.eu/blog/react-query-and-forms), [Working with Zustand](https://tkdodo.eu/blog/working-with-zustand)
- Zustand docs: [Flux inspired practice](https://zustand.docs.pmnd.rs/guides/flux-inspired-practice), [Practice with no store actions](https://zustand.docs.pmnd.rs/guides/practice-with-no-store-actions), [Prevent rerenders with useShallow](https://zustand.docs.pmnd.rs/guides/prevent-rerenders-with-use-shallow), [persist](https://zustand.docs.pmnd.rs/middlewares/persist)
- shadcn: [AI Elements](https://ui.shadcn.com/docs/ai-elements), [Pagination](https://ui.shadcn.com/docs/components/pagination), [Skills](https://ui.shadcn.com/docs/skills)
- Emil Kowalski: [emil-design-eng skill](https://github.com/emilkowalski/skills/tree/main/skills/emil-design-eng)
- skills CLI: [skills.sh](https://skills.sh) ([commands](https://github.com/vercel-labs/skills/blob/main/docs/commands.md))
- TanStack Query docs: [persistQueryClient](https://tanstack.com/query/latest/docs/framework/react/plugins/persistQueryClient), [Paginated queries](https://tanstack.com/query/latest/docs/framework/react/guides/paginated-queries)
- TanStack Router docs: [Custom link (`createLink`)](https://tanstack.com/router/latest/docs/framework/react/guide/custom-link), [Search params](https://tanstack.com/router/latest/docs/framework/react/guide/search-params)
- web.dev: [Cumulative Layout Shift](https://web.dev/articles/cls)
- React: [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect), [React Compiler](https://react.dev/learn/react-compiler)
- ren-v2: `packages/client` (generated client and Query options), `packages/chat` (`ChatReact`, `TimelineRow`, `Projection`)
