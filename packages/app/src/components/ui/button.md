# Button

Generated with `shadcn add button` (style `base-nova`, Base UI).

## Changes to the component

- It transitions only colors, shadow and scale (150ms, ease-out) instead of `transition-all`, and presses to 97% scale instead of moving down 1px (`emil-design-eng`).
- The `default` size has 12px side padding instead of 10px, as Ren's buttons do.
- Ren uses two sizes. `sm` is 26px tall with 12px text and 14px icons (stock 28px, 12.8px text); `icon-sm` is a 26px square (stock 28px). `default` (32px) and `icon` (32px square) are stock. `xs`, `icon-xs`, `lg` and `icon-lg` are removed.

Props, parts and names are still shadcn's.

## What looks different, and why

Beyond the changes above, the look comes from the theme (see `src/index.css`). This component reads these theme values:

| shadcn variable        | Ren value   | Ren role                                               |
| ---------------------- | ----------- | ------------------------------------------------------ |
| `background`           | #151515     | Ren bg-primary — the main page surface                 |
| `foreground`           | #f1f1f1     | Ren text-primary                                       |
| `primary`              | #f1f1f1     | Ren text-primary used as a fill — the strongest action |
| `primary-foreground`   | #101010     | Ren text-inverse                                       |
| `secondary`            | white at 8% | Ren fill-secondary                                     |
| `secondary-foreground` | #f1f1f1     | Ren text-primary                                       |
| `muted`                | white at 4% | Ren fill-primary                                       |
| `destructive`          | #f47780     | Ren status-danger                                      |
| `border`               | white at 8% | Ren border-primary                                     |
| `input`                | white at 8% | Ren border-primary                                     |
| `ring`                 | #268bff     | Ren accent-primary — focus rings                       |

Corners: Ren's radius scale replaces shadcn's: `rounded-sm` 4px, `rounded-md` and `rounded-lg` 8px, `rounded-xl` 12px, `rounded-2xl` 16px.

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.

## Variants Ren uses

See `VARIANTS.md` at the repo root. The code still has every stock variant; Ren picks from that list.

## Call-site overrides

Ren restyles this component where it is used, to match useren.ai. See "Call-site overrides" in `VARIANTS.md`.
