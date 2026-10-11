import { MenuItem, RowActionsMenu } from "ren-v1/composites/menu"
import { Icon } from "../../ui/src/components/icon.js"
import meta from "../../ui/src/components/row-actions-menu.stories.js"

export default {
  ...meta,
  title: "Parity/Row Actions Menu",
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

export { Default } from "../../ui/src/components/row-actions-menu.stories.js"
