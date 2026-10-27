# Card

Generated with `shadcn add card` (style `base-nova`, Base UI).

## Changes to the component

None. The code in `card.tsx` is exactly what the shadcn CLI generated. Its props, parts and names are shadcn's.

## What looks different, and why

Only the theme changed (see `src/index.css`). This component reads these theme values:

| shadcn variable    | Ren value   | Ren role                           |
| ------------------ | ----------- | ---------------------------------- |
| `foreground`       | #f1f1f1     | Ren text-primary                   |
| `card`             | #1f1f1f     | Ren bg-secondary — raised surfaces |
| `card-foreground`  | #f1f1f1     | Ren text-primary                   |
| `muted`            | white at 4% | Ren fill-primary                   |
| `muted-foreground` | #a3a3a3     | Ren text-secondary                 |

Corners: Ren's radius scale replaces shadcn's: `rounded-sm` 4px, `rounded-md` and `rounded-lg` 8px, `rounded-xl` 12px, `rounded-2xl` 16px.

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.

## Call-site overrides

Ren restyles this component where it is used, to match useren.ai. See "Call-site overrides" in `VARIANTS.md`.
