# Sidebar

Generated with `shadcn add sidebar` (style `base-nova`, Base UI).

## Changes to the component

None. The code in `sidebar.tsx` is exactly what the shadcn CLI generated. Its props, parts and names are shadcn's.

## What looks different, and why

Only the theme changed (see `src/index.css`). This component reads these theme values:

| shadcn variable             | Ren value   | Ren role                                        |
| --------------------------- | ----------- | ----------------------------------------------- |
| `background`                | #151515     | Ren bg-primary — the main page surface          |
| `sidebar`                   | #101010     | Ren bg-tertiary                                 |
| `sidebar-foreground`        | #a3a3a3     | Ren text-secondary                              |
| `sidebar-accent`            | white at 8% | Ren fill-secondary — hover and the current page |
| `sidebar-accent-foreground` | #f1f1f1     | Ren text-primary                                |
| `sidebar-border`            | white at 8% | Ren border-primary                              |
| `sidebar-ring`              | #268bff     | Ren accent-primary                              |

Corners: Ren's radius scale replaces shadcn's: `rounded-sm` 4px, `rounded-md` and `rounded-lg` 8px, `rounded-xl` 12px, `rounded-2xl` 16px.

Icons: Tabler instead of Lucide, because `components.json` sets `iconLibrary` to `tabler` (`IconLayoutSidebar`).

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.

## Call-site overrides

Ren restyles this component where it is used, to match useren.ai. See "Call-site overrides" in `VARIANTS.md`.
