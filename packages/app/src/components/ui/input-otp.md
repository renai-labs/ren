# Input Otp

Generated with `shadcn add input-otp` (style `base-nova`, Base UI).

## Changes to the component

None. The code in `input-otp.tsx` is exactly what the shadcn CLI generated. Its props, parts and names are shadcn's.

## What looks different, and why

Only the theme changed (see `src/index.css`). This component reads these theme values:

| shadcn variable | Ren value | Ren role |
| --- | --- | --- |
| `foreground` | #f1f1f1 | Ren text-primary |
| `destructive` | #f47780 | Ren status-danger |
| `input` | white at 8% | Ren border-primary |
| `ring` | #268bff | Ren accent-primary — focus rings |

Corners: `--radius` is 8px (Ren's control radius) instead of shadcn's 10px, so `rounded-lg` is 8px.

Icons: Tabler instead of Lucide, because `components.json` sets `iconLibrary` to `tabler` (`IconMinus`).

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.
