# @ren/ui

The design system. It owns every visual decision in Ren: tokens, components and motion. It is moving from Ren's own components to shadcn's (style `base-nova` on Base UI, Tabler icons), replaced one at a time under the same `@ren/ui/<name>` path. Load the `shadcn`, `react` and `interface` skills before writing components.

## Structure

- `src/components/<name>.tsx` holds one component per file, exported as `@ren/ui/<name>`. There is no root barrel and there are no tiers.
- `src/lib/` holds internal helpers such as `composeClasses` and formatters. It is never exported.
- `src/styles/` holds `index.css`, `tokens.generated.css`, `theme.css`, `fonts.css` and `motion.css`. `index.css` also loads `tw-animate-css` and `shadcn/tailwind.css`.
- `components.json` configures the shadcn CLI. Its aliases are the package's `#components/*`, `#lib/*` and `#hooks/*` imports.

## shadcn components

- Add or update one with `bunx --bun shadcn@latest add <name>` from this directory. Move any dependency the CLI adds into the root catalog, then fix what `bun run check` reports: Ren's lint and TypeScript settings (`exactOptionalPropertyTypes`, no comments, a focus ring wherever `outline-none` appears) are stricter than shadcn's.
- Keep shadcn's API: its named exports and parts (`Tabs`, `TabsList`, `TabsTrigger`), `variant` and `size`, and `className` on every part. Don't rename props, variants or parts, so `shadcn diff` keeps working.
- A look that is the same everywhere in Ren is a change in the component file; describe it in the commit that makes it, so the next `shadcn diff` can carry it forward. A one-off look is a `className` at the call site.
- Use the variants and sizes `VARIANTS.md` lists for each component. A link styled as a button keeps its link role: put `className={buttonVariants({ variant, size })}` on the `Link`.
- Remove a component when nothing uses it.
- shadcn's theme variables (`background`, `primary`, `muted-foreground`, `sidebar`…) and its radius scale map onto Ren's tokens in `theme.css`. Style with those names or Ren's tokens, never a raw colour.
- Merge classes with `cn` from the `cn` package, as shadcn ships it, and import icons from `@tabler/icons-react`.
- Motion: transition colour, opacity and transform only, under 300 ms with `ease-out`, nothing on frequent or keyboard-driven actions, and respect `prefers-reduced-motion`.

## Ren components

Ren's own components and compositions (`Form`, `FormActions`, `FormSection`, `ConfirmationDialog`, `SearchField`, `InlineEdit`, `Combobox`, the shells, `Page`, `Text`, `Icon`, `Link`, `Time`, `StatusDot`, `ModelPicker`, `ThemeSelector`, `CopyButton`, `FindBar`, `PromptInput`, `Markdown`, `ImageLightbox`, `ConnectionBoard`, the `Task*` components and the rest without a shadcn file) follow these rules. Build their insides from the shadcn components.

- Follow Base UI's shape:
  - A multi-part component uses Ren's module pattern. The file starts with `export * as Dialog from "./dialog.js"` and exports parts named `Root`, `Trigger`, `Popup`, `Title` and so on. Consumers write `<Dialog.Root>`.
  - A single-part component exports the component itself (`export function Button`), so consumers write `<Button>`, not `<Button.Root>`.
- Wrap Base UI parts. Don't re-implement behaviour Base UI already provides, such as focus management, dismissal, positioning or ARIA.
- When a single-part component shares its name with the Base UI namespace it wraps (`Checkbox`, `Switch`), name the function `<Name>Control` and end the file with `export { <Name>Control as <Name> }`. Imports stay unaliased.
- Keep ren-v1's `data-slot` names. Theme decorations such as girliepop target them.
- Public props are semantic (`appearance`, `tone`, `size`, `purpose`).
- Define variants with cva, and merge classes with `composeClasses`. Never concatenate class strings by hand.
- Style Base UI states with data-attribute variants (`data-checked:`, `data-highlighted:`, `data-disabled:`) and Base UI's CSS variables (`--anchor-width`, `--available-height`, `--transform-origin`). `shadcn/tailwind.css` redefines `data-open`, `data-closed`, `data-checked`, `data-unchecked`, `data-selected`, `data-disabled`, `data-active`, `data-horizontal` and `data-vertical` with `:where()`, so they lose to `hover:` and other pseudo-classes on the same property.
- Animate with the durations and easings in `motion.css`.
- Glyphs come from the icon wrapper (`@ren/ui/icon`), which maps Tabler icons. Load heavy renderers (charts, code highlighting, markdown editing) lazily behind the component.

## Design fidelity

- Tokens come from the Paper file "Ren UI" through `DESIGN.md` (use the `sync-with-paper` skill) and `bun run generate`. Never edit `DESIGN.md` or `tokens.generated.css` by hand, and never rename a token. `theme.css` maps shadcn's names onto the tokens.
- When porting from `ren-v1/packages/ui`, keep class strings, variants, sizes and states identical. A visual change is a separate, explicit decision.
- Approved deviations from ren-v1:
  - `Text` balances headings (`text-balance`) and avoids orphans in body copy (`text-pretty`).
  - `Text purpose="display"` renders at `text-display`. ren-v1's `composeClasses` did not know the size, so its tone class stripped it.
  - Classes that borrow another role's colour move to role tokens with identical values: `bg-text-primary` to `bg-fill-inverse`, `bg-text-secondary` to `bg-fill-inverse-secondary`, and `border-`, `ring-` and `outline-text-primary` to `border-strong`. Lines drawn with `bg-border-primary` become borders.
  - `ConfirmationDialog` ignores outside clicks; Escape and Cancel still close it.
  - `InlineEdit` returns focus to its Edit button after Enter or Escape, and shows validation and save errors while editing, linked to the input.
  - `Text activity="active"` pulses between `text-secondary` and `text-primary` instead of fading to 50% opacity, which failed contrast.
  - Light `accent-primary` is `#0065cc` (ren-v1 `#0067d0`) so accent text passes AA on its tint. Mirror it in Paper.
  - `ThemeSelector` draws the bars in its previews with borders instead of `bg-border-*` fills, so their rounded ends anti-alias differently.
  - `ConnectionBoard` columns use `overscroll-contain`, so scrolling past a column's end doesn't scroll the page. Their socket dots are drawn with borders instead of `bg-border-secondary` fills, with identical pixels.

## Testing

- This package has no tests. Do not add any. Check components in the running app, in dark and light.
