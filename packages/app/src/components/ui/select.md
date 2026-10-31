# Select

Generated with `shadcn add select` (style `base-nova`, Base UI).

## Changes to the component

- The trigger shows a down chevron instead of the up-and-down selector, has 12px side padding, no tinted fill and no focus glow (a 1px blue border only).
- The popup opens below the trigger instead of over it (`alignItemWithTrigger` defaults to false).
- Items and group labels match the menu's: 32px items with 8px padding and 4px corners.
- Fields sit on Ren bg-secondary (#1F1F1F, `bg-card`) instead of a transparent fill.

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
| `input`              | white at 8% | Ren border-primary                              |
| `ring`               | #268bff     | Ren accent-primary — focus rings                |

Corners: Ren's radius scale replaces shadcn's: `rounded-sm` 4px, `rounded-md` and `rounded-lg` 8px, `rounded-xl` 12px, `rounded-2xl` 16px.

Icons: Tabler instead of Lucide, because `components.json` sets `iconLibrary` to `tabler` (`IconCheck`, `IconChevronDown`, `IconChevronUp`, `IconSelector`).

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.

## Call-site overrides

Ren restyles this component where it is used, to match useren.ai. See "Call-site overrides" in `VARIANTS.md`.
