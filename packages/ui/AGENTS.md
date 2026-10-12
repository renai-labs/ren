# @ren/ui

The design system. It owns every visual decision in Ren: tokens, components and motion. Load the `react` and `interface` skills before writing components.

## Structure

- `src/components/<name>.tsx` holds one component namespace per file and is exported as `@ren/ui/<name>`. There is no root barrel and there are no tiers.
- `src/components/<name>.stories.tsx` holds that component's stories. Nothing imports it.
- `src/lib/` holds internal helpers such as `composeClasses` and formatters. It is never exported.
- `src/styles/` holds `index.css`, `tokens.generated.css`, `theme.css`, `fonts.css` and `motion.css`.

## Components

- Follow Base UI's shape:
  - A multi-part component uses Ren's module pattern. The file starts with `export * as Dialog from "./dialog.js"` and exports parts named `Root`, `Trigger`, `Popup`, `Title` and so on. Consumers write `<Dialog.Root>`.
  - A single-part component exports the component itself (`export function Button`), so consumers write `<Button>`, not `<Button.Root>`.
- Wrap Base UI parts. Don't re-implement behaviour Base UI already provides, such as focus management, dismissal, positioning or ARIA.
- When a single-part component shares its name with the Base UI namespace it wraps (`Checkbox`, `Switch`), name the function `<Name>Control` and end the file with `export { <Name>Control as <Name> }`. Imports stay unaliased.
- Keep ren-v1's `data-slot` names. Theme decorations such as girliepop target them.
- Public props are semantic (`appearance`, `tone`, `size`, `purpose`). Omit `className` and `style` from public props so app code cannot restyle components. Layout belongs to the parent.
- Define variants with cva, and merge classes with `composeClasses`. Never concatenate class strings by hand.
- Style Base UI states with data-attribute variants (`data-checked:`, `data-highlighted:`, `data-disabled:`) and Base UI's CSS variables (`--anchor-width`, `--available-height`, `--transform-origin`).
- Animate with CSS transitions on `data-starting-style:` and `data-ending-style:`, using the durations and easings in `motion.css`. Respect `prefers-reduced-motion`.
- Glyphs come only from the icon wrapper (`@ren/ui/icon`), which maps Tabler icons. Load heavy renderers (charts, code highlighting, markdown editing) lazily behind the component.

## Design fidelity

- Tokens come from the Paper file "Ren UI" through `DESIGN.md` (use the `sync-with-paper` skill) and `bun run generate`. Never edit `DESIGN.md` or `tokens.generated.css` by hand, never rename a token, and never use a colour, size, radius or duration that is not a token.
- When porting from `ren-v1/packages/ui`, keep class strings, variants, sizes and states identical. A visual change is a separate, explicit decision. Run the Storybook parity check in dark and light before merging.
- Approved deviations from ren-v1:
  - Text inputs use `text-base sm:text-sm`, so iOS doesn't zoom the page on focus.
  - `Text` balances headings (`text-balance`) and avoids orphans in body copy (`text-pretty`).
  - `Text purpose="display"` renders at `text-display`. ren-v1's `composeClasses` did not know the size, so its tone class stripped it.
  - Classes that borrow another role's colour move to role tokens with identical values: `bg-text-primary` to `bg-fill-inverse`, `bg-text-secondary` to `bg-fill-inverse-secondary`, and `border-`, `ring-` and `outline-text-primary` to `border-strong`. Lines drawn with `bg-border-primary` become borders.
  - `Checkbox` has an indeterminate state; ren-v1 had none.
  - Tabs, breadcrumb links, list rows and cards show a focus-visible ring; ren-v1's `outline-none` hid keyboard focus.
  - `Toast` uses `text-text-secondary` descriptions and `shadow-overlay`, which sonner's stylesheet overrode in ren-v1. Toast has no parity file.
  - `Dialog.Footer` stacks in DOM order on small screens, so Cancel sits above the primary action.
  - `ConfirmationDialog` ignores outside clicks; Escape and Cancel still close it.
  - `Menu.Search` keeps its glyph at 16px; ren-v1's input squeezed it.
  - `InlineEdit` returns focus to its Edit button after Enter or Escape, and shows validation and save errors while editing, linked to the input.
  - `ApplicationShell` gives collapsed navigation items an accessible name, and its mobile drawer's panel button reads "Close navigation".
  - Image avatars that are not decorative get `role="img"`.
  - `Document` streams in with Ren's motion easing instead of `ease-out`.
  - Controls inside `Field` take their label, description and invalid state from Base UI, so a `Select` inside an invalid field turns red. ren-v1 dropped the invalid state there.

## Stories

- Every component has stories in CSF 3: `title: "UI/<Name>"`, `component` set, and the meta checked with `satisfies Meta<typeof Component>`.
- Write one story per variant, size and prop-driven state (`Default`, `Secondary`, `Small`, `Disabled`, `Invalid`). Each story shows one thing through `args`. Use `render` only to compose the parts of a compound component.
- Don't fake interactive states such as hover, focus or open with attributes. Browser specs reach them through Playwright.
- Stories carry no descriptions or docs prose. Prop types are the API documentation.
- Check a visual change by opening its stories in dark and light (`bun run dev:storybook` from the repo root).

## Testing

- Every component gets a `bun test` file under `test/` for roles, labels, attributes and prop-driven states.
- Behaviour that needs a real browser (focus movement, keyboard navigation, pointer, popups, positioning, scrolling, layout) gets a Playwright spec in `packages/storybook/tests/ui/<name>.spec.ts` that mounts the component's stories. Don't repeat a contract that `bun test` already proves.
- Don't test class strings.
