import { Avatar } from "@ren/ui/avatar"
import { List } from "@ren/ui/list"
import { StatusDot } from "@ren/ui/status-dot"
import type { ReactNode } from "react"

// oxlint-disable-next-line ren/no-comments -- ren-v1 MarketplaceRow: one app in a list, for the Marketplace and for a space's apps.
export function AppRow(props: {
  name: string
  icon: string | undefined
  caption: string
  attention?: boolean
  onOpen?: () => void
  action?: ReactNode
}) {
  return (
    <List.Item
      {...(props.onOpen && { label: `Open ${props.name}`, onActivate: props.onOpen })}
      leading={
        <Avatar.Root name={props.name} image={props.icon} size="large" shape="square" imageFit="contain" decorative />
      }
      title={props.name}
      badge={props.attention ? <StatusDot tone="warning" label="Needs attention" /> : undefined}
      description={props.caption}
      actionsVisibility="always"
      actions={props.action}
    />
  )
}

export function AppGrid(props: { label: string; children: ReactNode }) {
  return (
    <List.Root label={props.label}>
      <div className="grid grid-cols-1 gap-x-12 gap-y-1 md:grid-cols-2">{props.children}</div>
    </List.Root>
  )
}
