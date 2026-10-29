# Attachment

Generated with `shadcn add attachment` (style `base-nova`, Base UI).

## Changes to the component

- `AttachmentAction` defaults to Button size `icon-sm` (26px) instead of `icon-xs`, which Ren's Button no longer has. Props, parts and names are shadcn's.

## What looks different, and why

Only the theme changed (see `src/index.css`). This component reads these theme values:

| shadcn variable    | Ren value   | Ren role                           |
| ------------------ | ----------- | ---------------------------------- |
| `foreground`       | #f1f1f1     | Ren text-primary                   |
| `card`             | #1f1f1f     | Ren bg-secondary — raised surfaces |
| `card-foreground`  | #f1f1f1     | Ren text-primary                   |
| `muted`            | white at 4% | Ren fill-primary                   |
| `muted-foreground` | #a3a3a3     | Ren text-secondary                 |
| `destructive`      | #f47780     | Ren status-danger                  |
| `ring`             | #268bff     | Ren accent-primary — focus rings   |

Corners: `--radius` is 8px (Ren's control radius) instead of shadcn's 10px, so `rounded-lg` is 8px, `rounded-md` is 6.4px, `rounded-xl` is 11.2px.

Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.
