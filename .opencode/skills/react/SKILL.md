---
name: react
description: Use when writing, reviewing or refactoring React code in packages/ui or packages/app, covering component composition, data loading, updates and rendering performance.
---

# React in Ren

Lint enforces most React rules: run `bun run lint` and follow each message. This skill covers the judgment calls a rule cannot check. Package structure lives in `packages/ui/AGENTS.md` and `packages/app/AGENTS.md`.

## Composition

- Build anything with more than one region as compound parts that share context, the way Base UI does: `Composer.Root`, `Composer.Input`, `Composer.Submit`. Parts read context. Consumers pick the parts they need instead of toggling them with props.
- Give a compound context three parts: `state`, `actions` and `meta` (refs and other handles). Parts depend on that interface only.
- The provider is the only place that knows where state comes from: `useState`, a query, or the sync layer. Swapping the provider must not change the parts.
- Lift state into the provider when something outside the visual frame needs it, such as a dialog's submit button or a preview. Never sync state upward with effects or read it from refs.
- Model modes as explicit variants that compose shared parts, such as `EditMessageComposer` and `ThreadComposer`. This also applies to string mode props like `mode="edit"`, which lint does not catch.

## Data and async

- Route loaders start fetches and return without awaiting them (`Loader.start(queryClient.query(...), ...)`; lint enforces it). The page reads the same options with `useQuery`, renders its frame at once and draws skeletons where the data goes while the query is pending, so a navigation commits immediately. The route's `pendingComponent` is that page's skeleton in the same frame; the router shows it only while a lazy chunk or `beforeLoad` takes longer than `defaultPendingMs`.
- A query the page cannot render without spreads `Loader.required`, so a failed first load reaches the route's error component as an awaited loader did. A list whose key follows the URL (filters, page) adds `placeholderData: keepPreviousData` and dims while `isPlaceholderData`.
- Await in a loader only to redirect or act on the data, and say why in the ast-grep-ignore.
- Start independent work together.
- Inside a function, check cheap synchronous conditions first, and move each `await` into the branch that needs it.
- Place `<Suspense>` around the region that waits, and keep the surrounding layout outside so it paints immediately. Give independently loading regions their own boundaries.
- Subscribe to the narrowest value: Query `select`, router `useSearch({ select })`, store selectors that return booleans or primitives.
- Don't subscribe to values that only a callback reads. Read them inside the handler instead, for example with `queryClient.getQueryData` or `router.state`.

## Updates

- Wrap non-urgent updates that re-render a lot (filtering, switching views) in `startTransition`. Show `isPending` from `useTransition` or the mutation instead of keeping a loading flag in state.
- Feed expensive renders that depend on fast-changing input through `useDeferredValue`.
- Use the functional form `setX((previous) => ...)` whenever the next state depends on the previous one.
- Keep high-frequency transient values (pointer position, scroll offset, timers) in refs, not state.
- In the few effects that exist (`src/lib`, `src/platform`, `@ren/ui`):
  - Read the latest props through `useEffectEvent`.
  - Depend on primitives, not objects.
  - Run app-wide initialization once at module level or in `main.tsx`, never in a mount effect.
- Share global listeners (resize, keydown, online) through one module-level source read with `useSyncExternalStore`, not one listener per component.

## Rendering

- Virtualize long lists. Apply `content-visibility: auto` to long sections that are not virtualized.
- For UI that is hidden but should keep its state (tabs, side panels), use `<Activity mode="hidden">` instead of unmounting it.
- Animate a wrapping element, not the `<svg>` itself.
- Never interleave layout reads (`getBoundingClientRect`, `offsetWidth`) with style writes. Read first, then write, and prefer toggling classes or CSS to writing styles from JavaScript.
- Preload a lazy module on intent: `onPointerEnter` and `onFocus` call `void import("./heavy.js")`. Use `preload` and `preconnect` from `react-dom` for critical assets.
- Defer non-critical work (analytics, warming caches) with `requestIdleCallback`.
- Hoist `RegExp` and other constant values out of components and loops.

## View transitions

Router navigations already run inside `startTransition`, so React's `<ViewTransition>` animates them. Updates from `useDeferredValue` and Suspense reveals animate too.

- Animate only to communicate continuity, in this order of priority:
  1. A shared element going deeper (`name`).
  2. A Suspense reveal.
  3. List identity (`key` on each item).
  4. Something appearing or disappearing (`enter` and `exit`).
  5. A route change.
- Use directional slides only for hierarchy (list to detail) and ordered sequences. Lateral moves such as switching tabs fade or don't animate.
- Place `<ViewTransition>` before any DOM node in its subtree, or enter and exit won't fire. Don't put wrapper elements between a list and its per-item boundaries.
- Plain `setState` never animates. Trigger animations with `startTransition`, and tag the cause with `addTransitionType` inside it.
- Put `default="none"` on named and type-keyed boundaries so background updates don't cross-fade. A named pair then needs an explicit `share`. Leave keyed list items bare so they keep `update`.
- A `name` must be unique among mounted boundaries. Don't hard-code names in components that can render twice, for example in both a popover and a page.
- Pair every `enter` with an `exit`. Place page-level boundaries in route components, not layouts. Never use a fade-out exit on a page that has shared morphs.
- Transition types don't carry over to the later Suspense reveal. Use type maps for navigation and plain strings for reveals.
- Browser back and forward carry no types, so typed animations fall back to `default` there.
