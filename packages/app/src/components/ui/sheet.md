# Sheet

Generated with `shadcn add sheet` (style `base-nova`, Base UI).

## Changes to the component

- The backdrop matches the dialog's: dark at 50%, no blur.
- A right-side sheet is 560px wide with 12px rounded left corners, as Ren's drawers.
- The close button is muted; the header has no bottom padding and 4px between title and description.
- The footer matches the dialog's: a top border, 12px by 16px padding, Cancel left and the main action right.

Props, parts and names are still shadcn's.

## What looks different, and why

Beyond the changes above, the look comes from the theme (see `src/index.css`). This component reads these theme values:

| shadcn variable      | Ren value | Ren role                            |
| -------------------- | --------- | ----------------------------------- |
| `foreground`         | #f1f1f1   | Ren text-primary                    |
| `popover`            | #1f1f1f   | Ren bg-secondary — menus and popups |
| `popover-foreground` | #f1f1f1   | Ren text-primary                    |
| `muted-foreground`   | #a3a3a3   | Ren text-secondary                  |

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.
