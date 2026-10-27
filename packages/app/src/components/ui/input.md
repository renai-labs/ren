# Input

Generated with `shadcn add input` (style `base-nova`, Base UI).

## Changes to the component

- 12px side padding instead of 10px, no tinted fill, and no focus glow: focus shows a 1px blue border only.

Props, parts and names are still shadcn's.

## What looks different, and why

Beyond the changes above, the look comes from the theme (see `src/index.css`). This component reads these theme values:

| shadcn variable    | Ren value   | Ren role                         |
| ------------------ | ----------- | -------------------------------- |
| `foreground`       | #f1f1f1     | Ren text-primary                 |
| `muted-foreground` | #a3a3a3     | Ren text-secondary               |
| `destructive`      | #f47780     | Ren status-danger                |
| `input`            | white at 8% | Ren border-primary               |
| `ring`             | #268bff     | Ren accent-primary — focus rings |

Corners: Ren's radius scale replaces shadcn's: `rounded-sm` 4px, `rounded-md` and `rounded-lg` 8px, `rounded-xl` 12px, `rounded-2xl` 16px.

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.
