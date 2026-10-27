# Avatar

Generated with `shadcn add avatar` (style `base-nova`, Base UI).

## Changes to the component

None. The code in `avatar.tsx` is exactly what the shadcn CLI generated. Its props, parts and names are shadcn's.

## What looks different, and why

Only the theme changed (see `src/index.css`). This component reads these theme values:

| shadcn variable      | Ren value   | Ren role                                               |
| -------------------- | ----------- | ------------------------------------------------------ |
| `background`         | #151515     | Ren bg-primary — the main page surface                 |
| `primary`            | #f1f1f1     | Ren text-primary used as a fill — the strongest action |
| `primary-foreground` | #101010     | Ren text-inverse                                       |
| `muted`              | white at 4% | Ren fill-primary                                       |
| `muted-foreground`   | #a3a3a3     | Ren text-secondary                                     |
| `border`             | white at 8% | Ren border-primary                                     |

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.

## Variants Ren uses

See `VARIANTS.md` at the repo root. The code still has every stock variant; Ren picks from that list.

## Call-site overrides

Ren restyles this component where it is used, to match useren.ai. See "Call-site overrides" in `VARIANTS.md`.
