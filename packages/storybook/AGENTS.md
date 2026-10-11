# @ren/storybook

Storybook for `@ren/ui` components and `@ren/app` features, plus the Playwright specs that run against it. It holds no stories and no product code.

## Layout

- `.storybook/`: the config. Stories load only from `packages/ui/src/components/*.stories.tsx` and `packages/app/src/features/**/*.stories.tsx`; `ren/story-location` rejects any other location. The preview wraps every story in `Theme.Provider`, with a toolbar for dark, light and girliepop.
- `tests/story.ts`: the `story` test with a `visit(id, { theme, args })` fixture that opens one story in the preview iframe. A story id is the kebab-cased title and export: `UI/Button` + `Primary` is `ui-button--primary`.
- `tests/ui/<name>.spec.ts` and `tests/app/<domain>/<name>.spec.ts`: browser specs for behaviour `bun test` cannot prove (focus, keyboard, pointer, popups, positioning, scrolling, layout).
- `parity/` and `tests/parity/`: the ren-v1 parity check. Delete both when the migration ends.

## Commands

```sh
bun run dev           # Storybook on :6006 (also `bun run dev:storybook` from the root)
bun run test          # browser specs; starts Storybook on :6116 unless one is running
bun run build         # static build, which CI serves with script/serve.ts
REN_V1_PATH=../../../ren-v1 bun run test:parity
```

## Parity

- `parity/<name>.stories.tsx` re-exports the Ren story file's meta and stories with `title: "Parity/<Name>"` and the ren-v1 component imported from `ren-v1/<path>` (aliased to `$REN_V1_PATH/packages/ui/src/<path>`). When a prop differs between the two, define that story in the parity file with the ren-v1 props.
- Storybook loads parity stories, and Tailwind scans the ren-v1 sources, only when `REN_V1_PATH` is set.
- `test:parity` screenshots every parity story and its Ren story in dark and light and fails on any pixel difference. Diffs land in `test-results/`. Fix the difference, or record it as an approved deviation in `packages/ui/AGENTS.md`.
- Parity is local only: font rendering differs between macOS and Linux.

## Not adopted

- The Storybook Vitest addon: a third test runner, and it cannot render ren-v1.
- The Storybook MCP server: its docs come from JSDoc, which `ren/no-comments` bans.
- CSF Next: its stories import the preview config, which would make `ui` and `app` depend on this package.
