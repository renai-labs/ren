# Message Scroller

Generated with `shadcn add message-scroller` (style `base-nova`, Base UI).

## Changes to the component

None. The code in `message-scroller.tsx` is exactly what the shadcn CLI generated. Its props, parts and names are shadcn's.

## What looks different, and why

Only the theme changed (see `src/index.css`). This component reads these theme values:

| shadcn variable | Ren value   | Ren role                               |
| --------------- | ----------- | -------------------------------------- |
| `background`    | #151515     | Ren bg-primary — the main page surface |
| `foreground`    | #f1f1f1     | Ren text-primary                       |
| `muted`         | white at 4% | Ren fill-primary                       |
| `border`        | white at 8% | Ren border-primary                     |

Icons: Tabler instead of Lucide, because `components.json` sets `iconLibrary` to `tabler` (`IconArrowDown`).

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.
