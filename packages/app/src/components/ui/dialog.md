# Dialog

Generated with `shadcn add dialog` (style `base-nova`, Base UI).

## Changes to the component

- The backdrop is Ren's: dark at 50% (`rgb(20 20 20 / 0.5)`), with no blur.
- The dialog is 448px wide (`sm:max-w-md`) instead of 384px, with 12px between its parts.
- The close button sits 12px from the corner and is muted.
- The title is 16px on a 24px line; the header has 4px between title and description.
- The footer has no fill: a top border, 12px by 16px padding, and Cancel on the left with the main action on the right (`justify-between`).
- The panel uses Ren bg-primary (#151515, `bg-background`) instead of `popover`, so fields (#1F1F1F) stand out on it.

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

Corners: Ren's radius scale replaces shadcn's: `rounded-sm` 4px, `rounded-md` and `rounded-lg` 8px, `rounded-xl` 12px, `rounded-2xl` 16px.

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.
