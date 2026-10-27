# Tooltip

Generated with `shadcn add tooltip` (style `base-nova`, Base UI).

## Changes to the component

None. The code in `tooltip.tsx` is exactly what the shadcn CLI generated. Its props, parts and names are shadcn's.

## What looks different, and why

Only the theme changed (see `src/index.css`). This component reads these theme values:

| shadcn variable | Ren value | Ren role                               |
| --------------- | --------- | -------------------------------------- |
| `background`    | #151515   | Ren bg-primary — the main page surface |
| `foreground`    | #f1f1f1   | Ren text-primary                       |

Corners: Ren's radius scale replaces shadcn's: `rounded-sm` 4px, `rounded-md` and `rounded-lg` 8px, `rounded-xl` 12px, `rounded-2xl` 16px.

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.
