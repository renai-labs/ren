# Toggle

Generated with `shadcn add toggle` (style `base-nova`, Base UI).

## Changes to the component

- It transitions only colors and shadow instead of `transition-all` (`emil-design-eng`).

Props, parts and names are still shadcn's.

## What looks different, and why

Only the theme changed (see `src/index.css`). This component reads these theme values:

| shadcn variable | Ren value   | Ren role                         |
| --------------- | ----------- | -------------------------------- |
| `foreground`    | #f1f1f1     | Ren text-primary                 |
| `muted`         | white at 4% | Ren fill-primary                 |
| `destructive`   | #f47780     | Ren status-danger                |
| `input`         | white at 8% | Ren border-primary               |
| `ring`          | #268bff     | Ren accent-primary — focus rings |

Corners: `--radius` is 8px (Ren's control radius) instead of shadcn's 10px, so `rounded-lg` is 8px.

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.
