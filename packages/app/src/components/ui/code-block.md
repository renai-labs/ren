# Code Block

Generated with `shadcn add code-block` (style `base-nova`, Base UI).

## Changes to the component

- With `wrap`, the code grid's column is `minmax(0, 1fr)` (and `auto minmax(0, 1fr)` with line numbers). Stock sizes the column to the longest unbreakable word, so a long URL in tool output pushed past the block's edge and was cut off. Props, parts and names are shadcn's.
- `CodeBlockCopyButton` defaults to Button size `icon-sm` (26px) instead of `icon-xs`, which Ren's Button no longer has.

## What looks different, and why

Only the theme changed (see `src/index.css`). This component reads these theme values:

| shadcn variable    | Ren value   | Ren role                               |
| ------------------ | ----------- | -------------------------------------- |
| `background`       | #151515     | Ren bg-primary — the main page surface |
| `foreground`       | #f1f1f1     | Ren text-primary                       |
| `muted`            | white at 4% | Ren fill-primary                       |
| `muted-foreground` | #a3a3a3     | Ren text-secondary                     |
| `destructive`      | #f47780     | Ren status-danger                      |
| `input`            | white at 8% | Ren border-primary                     |
| `ring`             | #268bff     | Ren accent-primary — focus rings       |

Corners: `--radius` is 8px (Ren's control radius) instead of shadcn's 10px, so `rounded-lg` is 8px.

Icons: Tabler instead of Lucide, because `components.json` sets `iconLibrary` to `tabler` (`IconCheck`, `IconCopy`).

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.
