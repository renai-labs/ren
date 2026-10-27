# Breadcrumb

Generated with `shadcn add breadcrumb` (style `base-nova`, Base UI).

## Changes to the component

None. The code in `breadcrumb.tsx` is exactly what the shadcn CLI generated. Its props, parts and names are shadcn's.

## What looks different, and why

Only the theme changed (see `src/index.css`). This component reads these theme values:

| shadcn variable    | Ren value | Ren role           |
| ------------------ | --------- | ------------------ |
| `foreground`       | #f1f1f1   | Ren text-primary   |
| `muted-foreground` | #a3a3a3   | Ren text-secondary |

Icons: Tabler instead of Lucide, because `components.json` sets `iconLibrary` to `tabler` (`IconChevronRight`, `IconDots`).

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.
