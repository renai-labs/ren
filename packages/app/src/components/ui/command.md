# Command

Generated with `shadcn add command` (style `base-nova`, Base UI).

## Changes to the component

- The search row is borderless and 40px tall with a separator under it, as Ren's pickers.
- Items keep 4px corners inside a dialog, and group headings are regular weight.

Props, parts and names are still shadcn's.

## What looks different, and why

Beyond the changes above, the look comes from the theme (see `src/index.css`). This component reads these theme values:

| shadcn variable      | Ren value   | Ren role                            |
| -------------------- | ----------- | ----------------------------------- |
| `foreground`         | #f1f1f1     | Ren text-primary                    |
| `popover`            | #1f1f1f     | Ren bg-secondary — menus and popups |
| `popover-foreground` | #f1f1f1     | Ren text-primary                    |
| `muted`              | white at 4% | Ren fill-primary                    |
| `muted-foreground`   | #a3a3a3     | Ren text-secondary                  |
| `border`             | white at 8% | Ren border-primary                  |
| `input`              | white at 8% | Ren border-primary                  |

Corners: `--radius` is 8px (Ren's control radius) instead of shadcn's 10px, so `rounded-lg` is 8px, `rounded-sm` is 4.8px, `rounded-xl` is 11.2px.

Icons: Tabler instead of Lucide, because `components.json` sets `iconLibrary` to `tabler` (`IconCheck`, `IconSearch`).

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.
