# Alert

Generated with `shadcn add alert` (style `base-nova`, Base UI).

## Changes to the component

None. The code in `alert.tsx` is exactly what the shadcn CLI generated. Its props, parts and names are shadcn's.

## What looks different, and why

Only the theme changed (see `src/index.css`). This component reads these theme values:

| shadcn variable    | Ren value | Ren role                           |
| ------------------ | --------- | ---------------------------------- |
| `foreground`       | #f1f1f1   | Ren text-primary                   |
| `card`             | #1f1f1f   | Ren bg-secondary — raised surfaces |
| `card-foreground`  | #f1f1f1   | Ren text-primary                   |
| `muted-foreground` | #a3a3a3   | Ren text-secondary                 |
| `destructive`      | #f47780   | Ren status-danger                  |

Corners: `--radius` is 8px (Ren's control radius) instead of shadcn's 10px, so `rounded-lg` is 8px.

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.
