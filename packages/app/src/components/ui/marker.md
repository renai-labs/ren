# Marker

Generated with `shadcn add marker` (style `base-nova`, Base UI).

## Changes to the component

None. The code in `marker.tsx` is exactly what the shadcn CLI generated. Its props, parts and names are shadcn's.

## What looks different, and why

Only the theme changed (see `src/index.css`). This component reads these theme values:

| shadcn variable    | Ren value   | Ren role           |
| ------------------ | ----------- | ------------------ |
| `foreground`       | #f1f1f1     | Ren text-primary   |
| `muted-foreground` | #a3a3a3     | Ren text-secondary |
| `border`           | white at 8% | Ren border-primary |

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.
