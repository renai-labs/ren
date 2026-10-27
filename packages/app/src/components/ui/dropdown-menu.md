# Dropdown Menu

Generated with `shadcn add dropdown-menu` (style `base-nova`, Base UI).

## Changes to the component

- Items are 32px tall with 8px side padding, 8px between icon and text and 4px corners (were 28px, 6px, 6px and 8px). This applies to items, checkbox and radio items and submenu triggers.
- An inset item starts at 32px.
- Group labels are 12px regular weight with 8px padding above, as Ren's.

Props, parts and names are still shadcn's.

## What looks different, and why

Beyond the changes above, the look comes from the theme (see `src/index.css`). This component reads these theme values:

| shadcn variable      | Ren value   | Ren role                                        |
| -------------------- | ----------- | ----------------------------------------------- |
| `foreground`         | #f1f1f1     | Ren text-primary                                |
| `popover`            | #1f1f1f     | Ren bg-secondary — menus and popups             |
| `popover-foreground` | #f1f1f1     | Ren text-primary                                |
| `muted-foreground`   | #a3a3a3     | Ren text-secondary                              |
| `accent`             | white at 8% | Ren fill-secondary — hover and highlighted rows |
| `accent-foreground`  | #f1f1f1     | Ren text-primary                                |
| `destructive`        | #f47780     | Ren status-danger                               |
| `border`             | white at 8% | Ren border-primary                              |

Corners: Ren's radius scale replaces shadcn's: `rounded-sm` 4px, `rounded-md` and `rounded-lg` 8px, `rounded-xl` 12px, `rounded-2xl` 16px.

Icons: Tabler instead of Lucide, because `components.json` sets `iconLibrary` to `tabler` (`IconCheck`, `IconChevronRight`).

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.

## Call-site overrides

Ren restyles this component where it is used, to match useren.ai. See "Call-site overrides" in `VARIANTS.md`.
