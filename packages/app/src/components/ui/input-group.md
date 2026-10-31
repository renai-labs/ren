# Input Group

Generated with `shadcn add input-group` (style `base-nova`, Base UI).

## Changes to the component

- No focus glow or blue border when its control has focus; Ren's composer keeps its border.
- Fields sit on Ren bg-secondary (#1F1F1F, `bg-card`) instead of a transparent fill.

Props, parts and names are still shadcn's.

## What looks different, and why

Beyond the changes above, the look comes from the theme (see `src/index.css`). This component reads these theme values:

| shadcn variable    | Ren value   | Ren role                         |
| ------------------ | ----------- | -------------------------------- |
| `muted-foreground` | #a3a3a3     | Ren text-secondary               |
| `destructive`      | #f47780     | Ren status-danger                |
| `input`            | white at 8% | Ren border-primary               |
| `ring`             | #268bff     | Ren accent-primary — focus rings |

Corners: Ren's radius scale replaces shadcn's: `rounded-sm` 4px, `rounded-md` and `rounded-lg` 8px, `rounded-xl` 12px, `rounded-2xl` 16px.

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.

## Variants Ren uses

See `VARIANTS.md` at the repo root. The code still has every stock variant; Ren picks from that list.

## Call-site overrides

Ren restyles this component where it is used, to match useren.ai. See "Call-site overrides" in `VARIANTS.md`.
