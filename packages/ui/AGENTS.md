# @ren/ui

The design system: shadcn's components (style `base-nova` on Base UI, Tabler icons) on Ren's dark and light theme, Ren's chat parts, and the Software Factory board and analytics. Load the `shadcn`, `react` and `interface` skills before writing components.

## Structure

- `src/components/<name>.tsx` holds one component per file, exported as `@ren/ui/<name>`. There is no root barrel and there are no tiers.
- `src/lib/` holds internal helpers (the code highlighter, the factory model). Only `src/lib/factory/model.ts` is exported, as `@ren/ui/factory-model`.
- `src/hooks/` holds hooks the components share, imported as `#hooks/*`.
- `src/styles/` holds `index.css` (the theme on shadcn's variables; it loads `fonts.css`, `tw-animate-css`, `shadcn/tailwind.css` and `factory.css`). The app imports it as `@ren/ui/styles`.
- `components.json` configures the shadcn CLI. Its aliases point at the package's `#components/*` and `#hooks/*` imports.

## shadcn components

- Add or update one with `bunx --bun shadcn@latest add <name>` from this directory. Move any dependency the CLI adds into the root catalog, then fix what `bun run check` reports: Ren's lint and TypeScript settings (`exactOptionalPropertyTypes`, no comments, a focus ring wherever `outline-none` appears) are stricter than shadcn's.
- Keep shadcn's API: its named exports and parts (`Tabs`, `TabsList`, `TabsTrigger`), `variant` and `size`, and `className` on every part. Don't rename props, variants or parts, so `shadcn diff` keeps working.
- A look that is the same everywhere in Ren is a change in the component file; describe it in the commit that makes it, so the next `shadcn diff` can carry it forward. A one-off look is a `className` at the call site.
- Use the variants and sizes `VARIANTS.md` lists for each component, and list a repeated call-site override there. A link styled as a button keeps its link role: put `className={buttonVariants({ variant, size })}` on the `Link`.
- Remove a component when nothing uses it.
- Style with shadcn's theme variables (`background`, `primary`, `muted-foreground`, `sidebar`…) and its radius scale, never a raw colour. The factory board keeps its own `factory.css` tokens.
- Merge classes with `cn` from the `cn` package, as shadcn ships it, and import icons from `@tabler/icons-react`.
- Toasts are `sonner` (`@ren/ui/sonner`) and searchable menus are `cmdk` (`@ren/ui/command`), as shadcn ships them.
- Motion: transition colour, opacity and transform only, under 300 ms with `ease-out`, nothing on frequent or keyboard-driven actions, and respect `prefers-reduced-motion`. The code highlighter loads each language on first use; load any new heavy renderer lazily behind its component.

## Software Factory

- `factory-board` and `factory-analytics` render a space's factory from a `FactoryWorld` and `Analytics` the app builds from real tasks, agents and `/insights`.
- `src/lib/factory/simulate.ts` builds a simulated factory. The app uses it only for the figures the API does not report yet (tickets, QA passes, runs and time per stage), as `VARIANTS.md` lists under "Factory overview". Replace each one when the API reports it.

## Testing

- This package has no tests. Do not add any. Check components in the running app, in dark and light.
