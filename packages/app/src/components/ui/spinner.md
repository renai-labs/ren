# Spinner

Generated with `shadcn add spinner` (style `base-nova`, Base UI).

## Changes to the component

- Props are typed as the Tabler icon's props (`React.ComponentProps<typeof IconLoader>`) instead of `<svg>` props, because ren-v2's TypeScript config uses `exactOptionalPropertyTypes` and the two disagree on `stroke`.

## What looks different, and why

Only the theme changed (see `src/index.css`). This component reads these theme values:

No color variables.

Icons: Tabler instead of Lucide, because `components.json` sets `iconLibrary` to `tabler` (`IconLoader`).

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.
