# Pagination

Generated with `shadcn add pagination` (style `base-nova`, Base UI).

## Changes to the component

None. The code in `pagination.tsx` is exactly what the shadcn CLI generated. Its props, parts and names are shadcn's.

## What looks different, and why

Only the theme changed (see `src/index.css`). This component reads these theme values:

No color variables.

Icons: Tabler instead of Lucide, because `components.json` sets `iconLibrary` to `tabler` (`IconChevronLeft`, `IconChevronRight`, `IconDots`).

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.
