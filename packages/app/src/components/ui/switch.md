# Switch

Generated with `shadcn add switch` (style `base-nova`, Base UI).

## Changes to the component

- It transitions only colors and shadow instead of `transition-all` (`emil-design-eng`).
- On is Ren blue: the track uses `ring` (#268bff) instead of `primary`, with a white thumb, so every switch matches the Scheduled table.

Props, parts and names are still shadcn's.

## What looks different, and why

Only the theme changed (see `src/index.css`). This component reads these theme values:

| shadcn variable      | Ren value   | Ren role                                               |
| -------------------- | ----------- | ------------------------------------------------------ |
| `background`         | #151515     | Ren bg-primary — the main page surface                 |
| `foreground`         | #f1f1f1     | Ren text-primary                                       |
| `primary`            | #f1f1f1     | Ren text-primary used as a fill — the strongest action |
| `primary-foreground` | #101010     | Ren text-inverse                                       |
| `destructive`        | #f47780     | Ren status-danger                                      |
| `input`              | white at 8% | Ren border-primary                                     |
| `ring`               | #268bff     | Ren accent-primary — focus rings                       |

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.
