# Sonner

Generated with `shadcn add sonner` (style `base-nova`, Base UI).

## Changes to the component

- The theme is fixed to `dark` instead of reading `next-themes`. Ren is dark only, so the app has no theme provider and no `next-themes` dependency.

## What looks different, and why

Only the theme changed (see `src/index.css`). This component reads these theme values:

No color variables.

Icons: Tabler instead of Lucide, because `components.json` sets `iconLibrary` to `tabler` (`IconAlertOctagon`, `IconAlertTriangle`, `IconCircleCheck`, `IconInfoCircle`, `IconLoader`).

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.
