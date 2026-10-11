import type { ReactNode } from "react"
import { Icon } from "./icon.js"
import { IconButton } from "./icon-button.js"
import { Menu } from "./menu.js"

export function RowActionsMenu(props: { label: string; children: ReactNode }) {
  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <IconButton label={props.label} size="small">
            <Icon glyph="MoreHorizontal" />
          </IconButton>
        }
      />
      <Menu.Popup alignment="end">{props.children}</Menu.Popup>
    </Menu.Root>
  )
}
