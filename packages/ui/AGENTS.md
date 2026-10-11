# @ren/ui

The design system. It owns every visual decision in Ren: tokens, components and motion. Load the `react` skill before writing components.

## Structure

- `src/components/<name>.tsx` holds one component namespace per file and is exported as `@ren/ui/<name>`. There is no root barrel and there are no tiers.
- `src/lib/` holds internal helpers such as `composeClasses` and formatters. It is never exported.
- `src/styles/` holds `index.css`, `tokens.generated.css`, `theme.css`, `fonts.css` and `motion.css`.

## Components

- Follow Base UI's shape:
  - A multi-part component uses Ren's module pattern. The file starts with `export * as Dialog from "./dialog.js"` and exports parts named `Root`, `Trigger`, `Popup`, `Title` and so on. Consumers write `<Dialog.Root>`.
  - A single-part component exports the component itself (`export function Button`), so consumers write `<Button>`, not `<Button.Root>`.
- Wrap Base UI parts. Don't re-implement behaviour Base UI already provides, such as focus management, dismissal, positioning or ARIA.
- Public props are semantic (`appearance`, `tone`, `size`, `purpose`). Omit `className` and `style` from public props so app code cannot restyle components. Layout belongs to the parent.
- Define variants with cva, and merge classes with `composeClasses`. Never concatenate class strings by hand.
- Style Base UI states with data-attribute variants (`data-checked:`, `data-highlighted:`, `data-disabled:`) and Base UI's CSS variables (`--anchor-width`, `--available-height`, `--transform-origin`).
- Animate with CSS transitions on `data-starting-style:` and `data-ending-style:`, using the durations and easings in `motion.css`. Respect `prefers-reduced-motion`.
- Glyphs come only from the icon wrapper (`@ren/ui/icon`), which maps Tabler icons. Load heavy renderers (charts, code highlighting, markdown editing) lazily behind the component.

## Design fidelity

- Tokens are generated from the Paper file "Ren UI". Never edit `tokens.generated.css` by hand, never rename a token, and never use a colour, size, radius or duration that is not a token.
- When porting from `ren-v1/packages/ui`, keep class strings, variants, sizes and states identical. A visual change is a separate, explicit decision. Compare against ren-v1 screenshots in dark and light before merging.

## Testing

- Every component gets a `bun test` file under `test/`.
- Test the rendered behaviour and accessibility contract: roles, labels, keyboard and states. Don't test class strings.
