# Trace

Generated with `shadcn add trace` (style `base-nova`, Base UI).

## Changes to the component

- `TraceLine`'s `status` also accepts `undefined`, so a line can pass `status={running ? "running" : undefined}` under ren-v2's `exactOptionalPropertyTypes`.

## What looks different, and why

Only the theme changed (see `src/index.css`). This component reads these theme values:

| shadcn variable | Ren value | Ren role |
| --- | --- | --- |
| `foreground` | #f1f1f1 | Ren text-primary |
| `muted-foreground` | #a3a3a3 | Ren text-secondary |
| `destructive` | #f47780 | Ren status-danger |
| `ring` | #268bff | Ren accent-primary — focus rings |

Corners: `--radius` is 8px (Ren's control radius) instead of shadcn's 10px, so `rounded-md` is 6.4px.

Icons: Tabler instead of Lucide, because `components.json` sets `iconLibrary` to `tabler` (`IconChevronRight`).

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.
