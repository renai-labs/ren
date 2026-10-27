# Calendar

Generated with `shadcn add calendar` (style `base-nova`, Base UI).

## Changes to the component

- `DayButton` passes `locale` only when it is set (`{...(locale && { locale })}`), because ren-v2's TypeScript config uses `exactOptionalPropertyTypes`.

## What looks different, and why

Only the theme changed (see `src/index.css`). This component reads these theme values:

| shadcn variable      | Ren value   | Ren role                                               |
| -------------------- | ----------- | ------------------------------------------------------ |
| `background`         | #151515     | Ren bg-primary — the main page surface                 |
| `foreground`         | #f1f1f1     | Ren text-primary                                       |
| `popover`            | #1f1f1f     | Ren bg-secondary — menus and popups                    |
| `primary`            | #f1f1f1     | Ren text-primary used as a fill — the strongest action |
| `primary-foreground` | #101010     | Ren text-inverse                                       |
| `muted`              | white at 4% | Ren fill-primary                                       |
| `muted-foreground`   | #a3a3a3     | Ren text-secondary                                     |
| `ring`               | #268bff     | Ren accent-primary — focus rings                       |

Icons: Tabler instead of Lucide, because `components.json` sets `iconLibrary` to `tabler` (`IconChevronDown`, `IconChevronLeft`, `IconChevronRight`).

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.
