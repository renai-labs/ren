---
name: shadcn
description: Use when adding, updating, composing or styling shadcn components in packages/ui or packages/app, including chat interfaces.
---

# shadcn in Ren

`@ren/ui` is Ren's shadcn library: style `base-nova` on Base UI (never Radix), Tabler icons, and `cn` from the `cn` package. `packages/ui/components.json` configures the CLI, and `packages/ui/AGENTS.md` has Ren's rules for the files.

Lint enforces every rule it can check: class restrictions in `oxlint.config.ts`, and component structure (overlay titles, item groups, `render` and `nativeButton`, links styled with `buttonVariants`, icon sizing, the chat parts) in `script/ast-grep/rules/`. Run `bun run check` and follow each message. This skill covers the judgment calls.

## Workflow

Run the CLI from `packages/ui` with `bunx --bun shadcn@latest`.

1. Read the docs first: `docs <name>` prints the documentation and example URLs; fetch them rather than guessing an API.
2. Check `packages/ui/src/components/` before adding. `@ren/ui/<name>` may already be shadcn's, or still Ren's own component with a different API.
3. Preview with `add <name> --dry-run`, and `--diff <file>` for a file that exists. Never fetch component source from GitHub by hand.
4. Add with `add <name>`. Overwrite a changed file only after reading the diff and carrying the local changes forward.
5. Move any new dependency into the root catalog, then fix what `bun run check` reports.

## Compose

- Use an existing component before writing markup, and compose before building: a settings page is `Tabs`, `Card` and form controls.
- Use a built-in `variant` and `size` before a `className`.
- Colours come from shadcn's names (`bg-primary`, `text-muted-foreground`, `text-destructive`) or Ren's tokens. Show status with a `Badge` variant or a semantic colour.
- Callouts are `Alert` (`AlertTitle`, `AlertDescription`). Empty states are `Empty` (`EmptyHeader`, `EmptyMedia`, `EmptyTitle`, `EmptyDescription`, `EmptyContent`).
- Cards use the full composition: `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`.
- Overlays: `Dialog` for a focused task, `AlertDialog` to confirm a destructive action, `Sheet` for a side panel of details or filters, `Popover` for small content on click, `HoverCard` for preview on hover, `Command` inside `Dialog` for a palette.
- `Button` has no loading prop. Compose `<Spinner data-icon="inline-start" />` with `disabled`.
- An icon beside a label takes `data-icon="inline-start"` or `"inline-end"`. Pass icons as components (`icon={IconCheck}`), not string keys.
- Live text shimmers with the `shimmer` utility, and scroll containers fade their edges with `scroll-fade`.

## Forms

- Lay forms out with `FieldGroup` and `Field`; settings rows use `Field orientation="horizontal"`. Group related checkboxes, radios or switches in `FieldSet` with `FieldLegend`.
- Pick the control: `Input`, `Textarea`, `Select` for a fixed list, `Combobox` when it needs search, `Switch` for a setting, `Checkbox` in a form, `RadioGroup` for one of a few, `ToggleGroup` for two to seven options (not a loop of `Button`s with an active state), `InputOTP` for codes.
- Buttons and icons inside a field go in `InputGroupAddon`, never positioned over an `Input`.
- An invalid field takes `data-invalid` on `Field` and `aria-invalid` on the control; a disabled one takes `data-disabled` on `Field` and `disabled` on the control.

## Base UI, not Radix

- `Select` takes an `items` prop, and the placeholder is the item whose value is `null`. `Select` supports `multiple` and object values with `itemToStringValue`.
- `ToggleGroup` and `Accordion` take `multiple` instead of `type`, and their values are arrays. A one-thumb `Slider` takes a number.

## Chat

Read [rules/chat.md](./rules/chat.md) before building or changing the transcript or composer.
