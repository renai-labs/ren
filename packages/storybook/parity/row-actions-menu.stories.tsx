import { MenuItem, RowActionsMenu } from "ren-v1/composites/menu"
import { Icon } from "@ren/ui/icon"
import meta from "../ui/row-actions-menu.stories.js"

export default {
  ...meta,
  component: RowActionsMenu,
  args: {
    ...meta.args,
    children: (
      <>
        <MenuItem icon={<Icon glyph="Link2" />}>Copy invite link</MenuItem>
        <MenuItem tone="danger" icon={<Icon glyph="Trash2" />}>
          Remove
        </MenuItem>
      </>
    ),
  },
}

export { Default } from "../ui/row-actions-menu.stories.js"
