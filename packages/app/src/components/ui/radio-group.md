# Radio Group

Generated with `shadcn add radio-group` (style `base-nova`, Base UI).

## Changes to the component

None. The code in `radio-group.tsx` is exactly what the shadcn CLI generated. Its props, parts and names are shadcn's.

## What looks different, and why

Only the theme changed (see `src/index.css`). This component reads these theme values:

| shadcn variable      | Ren value   | Ren role                                               |
| -------------------- | ----------- | ------------------------------------------------------ |
| `primary`            | #f1f1f1     | Ren text-primary used as a fill — the strongest action |
| `primary-foreground` | #101010     | Ren text-inverse                                       |
| `destructive`        | #f47780     | Ren status-danger                                      |
| `input`              | white at 8% | Ren border-primary                                     |
| `ring`               | #268bff     | Ren accent-primary — focus rings                       |

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.
