# @ren/storybook

The test harness for `@ren/ui` and `@ren/app` features: stories, the Playwright specs that run against them, an accessibility sweep, and the ren-v1 parity check. Paper is the design reference; Storybook is not a catalogue.

## Layout

- `ui/<name>.stories.tsx` and `ui/<name>.spec.ts`: one story file per `@ren/ui` component, named after it, and its browser spec. Stories import components through `@ren/ui/<name>`, so they only reach the public API.
- `app/<domain>/<name>.stories.tsx` and `.spec.ts`: stories and specs for app features.
- `sweep/stories.spec.ts`: opens every `ui` story in dark, light and girliepop, runs axe (WCAG 2.2 AA) and fails on violations and console errors.
- `support/story.ts`: the `story` test with a `visit(id, { theme, args })` fixture that opens one story in the preview iframe.
- `parity/`: the ren-v1 parity check. Delete it when the migration ends.
- `.storybook/`: the config. The preview wraps every story in `Theme.Provider` with a toolbar for dark, light and girliepop; a story with `parameters: { theme: "story" }` renders its own provider.

## Stories

- Titles come from file paths, so story ids follow file names: `ui/text-field.stories.tsx` + `WithError` is `ui-text-field--with-error`. Don't set `title`.
- CSF 3 with `component` set and the meta checked with `satisfies Meta<typeof Component>`.
- One story per variant, size and prop-driven state, each showing one thing through `args`. Use `render` to compose the parts of a compound component or to hold state a behaviour needs.
- Keep stories realistic: real copy, labelled controls, the way the app would use the component.
- Don't fake interactive states such as hover, focus or open with attributes. Specs reach them through Playwright.
- `ren/story-coverage` enforces that every component has a story file, that the file imports its component, that every exported part of a compound component appears in a story, and that no story or spec outlives its component. `ren/story-location` rejects stories anywhere else.

## Specs

- Storybook is the only test for components. There are no `bun test` component tests.
- Specs cover what a user or assistive technology sees: behaviour, focus and keyboard, accessible names and descriptions, announcements, integration contracts (controls inside `Field`, form validation and submit) and formatting. Find elements by role and accessible name.
- Don't assert class names, `data-slot` or markup. Leave ARIA validity and contrast to the sweep.
- Pin anything environment-dependent: `story.use({ timezoneId, locale })`, `page.clock`, `page.emulateMedia`.
- Specs run against the static build in CI. Assert Base UI state with data attributes where the production build differs (`data-popup-open` on submenu triggers).

## Commands

```sh
bun run dev           # Storybook on :6006 (also `bun run dev:storybook` from the root)
bun run test          # specs and the sweep; starts Storybook on :6116 unless one is running
bun run build         # static build, which CI serves with script/serve.ts
REN_V1_PATH=../../../ren-v1 bun run test:parity
```

## Parity

- `parity/<name>.stories.tsx` re-exports the matching `ui/` story file's meta and stories with the ren-v1 component imported from `ren-v1/<path>` (aliased to `$REN_V1_PATH/packages/ui/src/<path>`). When a prop differs between the two, define that story in the parity file with the ren-v1 props.
- Storybook loads parity stories, and Tailwind scans the ren-v1 sources, only when `REN_V1_PATH` is set.
- `test:parity` screenshots every parity story and its Ren story in dark and light and fails on any pixel difference. Diffs land in `test-results/`. Fix the difference, or record it as an approved deviation in `packages/ui/AGENTS.md` and leave that story out of the parity file.
- Parity is local only: font rendering differs between macOS and Linux.

## Not adopted

- The Storybook Vitest addon: a second runner beside Playwright, and it cannot render ren-v1.
- The Storybook MCP server: its docs come from JSDoc, which `ren/no-comments` bans.
