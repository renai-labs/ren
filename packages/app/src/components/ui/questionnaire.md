# Questionnaire

Generated with `shadcn add questionnaire` (style `base-nova`, Base UI).

## Changes to the component

None. The code in `questionnaire.tsx` is exactly what the shadcn CLI generated. Its props, parts and names are shadcn's.

## What looks different, and why

Only the theme changed (see `src/index.css`). This component reads these theme values:

| shadcn variable | Ren value | Ren role |
| --- | --- | --- |
| `background` | #151515 | Ren bg-primary — the main page surface |
| `primary` | #f1f1f1 | Ren text-primary used as a fill — the strongest action |
| `primary-foreground` | #101010 | Ren text-inverse |
| `muted` | white at 4% | Ren fill-primary |
| `muted-foreground` | #a3a3a3 | Ren text-secondary |
| `destructive` | #f47780 | Ren status-danger |
| `input` | white at 8% | Ren border-primary |
| `ring` | #268bff | Ren accent-primary — focus rings |

Corners: `--radius` is 8px (Ren's control radius) instead of shadcn's 10px, so `rounded-lg` is 8px, `rounded-md` is 6.4px.

Icons: Tabler instead of Lucide, because `components.json` sets `iconLibrary` to `tabler` (`IconCheck`).

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.
