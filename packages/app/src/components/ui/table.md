# Table

Generated with `shadcn add table` (style `base-nova`, Base UI).

## Changes to the component

None. The code in `table.tsx` is exactly what the shadcn CLI generated. Its props, parts and names are shadcn's.

## What looks different, and why

Only the theme changed (see `src/index.css`). This component reads these theme values:

| shadcn variable    | Ren value   | Ren role           |
| ------------------ | ----------- | ------------------ |
| `foreground`       | #f1f1f1     | Ren text-primary   |
| `muted`            | white at 4% | Ren fill-primary   |
| `muted-foreground` | #a3a3a3     | Ren text-secondary |

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.

## Call-site overrides

Ren restyles this component where it is used, to match useren.ai. See "Call-site overrides" in `VARIANTS.md`.
