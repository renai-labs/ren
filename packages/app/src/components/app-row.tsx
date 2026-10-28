import { Avatar, AvatarFallback, AvatarImage } from "@ren/ui/avatar"
import { Button } from "@ren/ui/button"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@ren/ui/item"
import { StatusDot } from "@ren/ui/status-dot"
import { Initials } from "@ren/util/initials"
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
    <Item render={<li />} className="relative gap-3 p-2 has-[[data-slot=app-open]:hover]:bg-muted">
      <ItemMedia>
        <Avatar size="lg" aria-hidden className="rounded-lg after:rounded-lg">
          <AvatarImage src={props.icon} alt="" className="m-auto size-3/4 rounded-none object-contain" />
          <AvatarFallback className="rounded-lg">{Initials.of(props.name)}</AvatarFallback>
        </Avatar>
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="max-w-full">
          {props.onOpen ? (
            <Button
              variant="ghost"
              data-slot="app-open"
              aria-label={`Open ${props.name}`}
              onClick={props.onOpen}
              className="h-auto min-w-0 justify-start truncate rounded-none border-0 p-0 font-medium after:absolute after:inset-0 after:rounded-lg hover:bg-transparent focus-visible:ring-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50 active:not-aria-[haspopup]:scale-100"
            >
              {props.name}
            </Button>
          ) : (
            <span className="truncate">{props.name}</span>
          )}
          {props.attention ? <StatusDot tone="warning" label="Needs attention" /> : null}
        </ItemTitle>
        <ItemDescription className="line-clamp-1 text-xs">{props.caption}</ItemDescription>
      </ItemContent>
      {props.action ? <ItemActions className="relative">{props.action}</ItemActions> : null}
    </Item>
  )
}

export function AppGrid(props: { label: string; children: ReactNode }) {
  return (
    <ItemGroup aria-label={props.label} className="grid grid-cols-1 gap-1 md:grid-cols-2 md:gap-x-6">
      {props.children}
    </ItemGroup>
  )
}
