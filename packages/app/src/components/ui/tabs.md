# Tabs

Generated with `shadcn add tabs` (style `base-nova`, Base UI).

## Changes to the component

- The trigger transitions only colors and shadow instead of `transition-all` (`emil-design-eng`).

Props, parts and names are still shadcn's.

## What looks different, and why

Only the theme changed (see `src/index.css`). This component reads these theme values:

| shadcn variable    | Ren value   | Ren role                               |
| ------------------ | ----------- | -------------------------------------- |
| `background`       | #151515     | Ren bg-primary — the main page surface |
| `foreground`       | #f1f1f1     | Ren text-primary                       |
| `muted`            | white at 4% | Ren fill-primary                       |
| `muted-foreground` | #a3a3a3     | Ren text-secondary                     |
| `input`            | white at 8% | Ren border-primary                     |
| `ring`             | #268bff     | Ren accent-primary — focus rings       |

Corners: Ren's radius scale replaces shadcn's: `rounded-sm` 4px, `rounded-md` and `rounded-lg` 8px, `rounded-xl` 12px, `rounded-2xl` 16px.

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.

## Call-site overrides

Ren restyles this component where it is used, to match useren.ai. See "Call-site overrides" in `VARIANTS.md`.
