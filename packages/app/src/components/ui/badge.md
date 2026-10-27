# Badge

Generated with `shadcn add badge` (style `base-nova`, Base UI).

## Changes to the component

- It transitions only colors and shadow instead of `transition-all` (`emil-design-eng`).

Props, parts and names are still shadcn's.

## What looks different, and why

Only the theme changed (see `src/index.css`). This component reads these theme values:

| shadcn variable        | Ren value   | Ren role                                               |
| ---------------------- | ----------- | ------------------------------------------------------ |
| `foreground`           | #f1f1f1     | Ren text-primary                                       |
| `primary`              | #f1f1f1     | Ren text-primary used as a fill — the strongest action |
| `primary-foreground`   | #101010     | Ren text-inverse                                       |
| `secondary`            | white at 8% | Ren fill-secondary                                     |
| `secondary-foreground` | #f1f1f1     | Ren text-primary                                       |
| `muted`                | white at 4% | Ren fill-primary                                       |
| `muted-foreground`     | #a3a3a3     | Ren text-secondary                                     |
| `destructive`          | #f47780     | Ren status-danger                                      |
| `border`               | white at 8% | Ren border-primary                                     |
| `ring`                 | #268bff     | Ren accent-primary — focus rings                       |

Corners: `--radius` is 8px (Ren's control radius) instead of shadcn's 10px, so `rounded-4xl` is 20.8px.

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.

## Variants Ren uses

See `VARIANTS.md` at the repo root. The code still has every stock variant; Ren picks from that list.

## Call-site overrides

Ren restyles this component where it is used, to match useren.ai. See "Call-site overrides" in `VARIANTS.md`.
