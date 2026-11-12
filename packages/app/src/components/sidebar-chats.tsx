import { useState } from "react"
import type { SessionInfo, SpaceInfo } from "@ren/client"
import { Link } from "@tanstack/react-router"
import { IconCube, IconLock } from "@tabler/icons-react"
import { cn } from "cn"
import { Button } from "@ren/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ren/ui/collapsible"
import { SidebarMenuButton, SidebarMenuItem } from "@ren/ui/sidebar"
import { sessionTitle } from "../lib/sessions.js"

const shown = 5

interface Group {
  readonly spaceId: string
  readonly space: SpaceInfo | undefined
  readonly chats: ReadonlyArray<SessionInfo>
}

// oxlint-disable-next-line ren/no-comments -- Chats by space; a space's place is that of its most recent chat.
const groupsOf = (chats: ReadonlyArray<SessionInfo>, spaces: ReadonlyArray<SpaceInfo>): ReadonlyArray<Group> => {
  const spaceById = new Map(spaces.map((space) => [space.id, space]))
  const bySpace = new Map<string, Array<SessionInfo>>()
  for (const chat of chats) bySpace.set(chat.spaceId, [...(bySpace.get(chat.spaceId) ?? []), chat])
  return [...bySpace.entries()].map(([spaceId, list]) => ({ spaceId, space: spaceById.get(spaceId), chats: list }))
}

function SpaceIcon(props: { space: SpaceInfo | undefined }) {
  return props.space?.kind === "private" ? <IconLock /> : <IconCube />
}

function ShowMore(props: { open: boolean; rest: number; onToggle: () => void }) {
  if (props.rest <= 0) return null
  return (
    <li>
      <Button
        variant="ghost"
        onClick={props.onToggle}
        className="h-8 w-full justify-start rounded-md pr-2 pl-7.5 font-medium text-sidebar-foreground/50 hover:bg-transparent hover:text-sidebar-foreground active:not-aria-[haspopup]:scale-100 dark:hover:bg-transparent"
      >
        {props.open ? "Show less" : "Show more"}
      </Button>
    </li>
  )
}

function SpaceGroup(props: {
  group: Group
  path: string
  rowClass: string
  status: (chat: SessionInfo) => React.ReactNode
}) {
  const [more, setMore] = useState(false)
  const [open, setOpen] = useState(true)
  const visible = more ? props.group.chats : props.group.chats.slice(0, shown)
  return (
    <Collapsible
      render={<li />}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setMore(false)
      }}
    >
      <ul className="flex flex-col gap-px">
        <SidebarMenuItem>
          <CollapsibleTrigger render={<SidebarMenuButton className={cn(props.rowClass, "pl-1.5")} />}>
            <SpaceIcon space={props.group.space} />
            <span className="truncate">{props.group.space?.name ?? "Space"}</span>
          </CollapsibleTrigger>
        </SidebarMenuItem>
      </ul>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height,opacity] duration-200 ease-out data-ending-style:h-0 data-ending-style:opacity-0 data-starting-style:h-0 data-starting-style:opacity-0 motion-reduce:transition-none">
        <ul className="flex flex-col gap-px pt-px">
          {visible.map((chat) => (
            <SidebarMenuItem key={chat.id}>
              <SidebarMenuButton
                className={cn(props.rowClass, "py-1.5 pr-2 pl-7.5 group-has-data-[sidebar=menu-badge]/menu-item:pr-7")}
                isActive={props.path === `/sessions/${chat.id}`}
                render={<Link to="/sessions/$sessionId" params={{ sessionId: chat.id }} />}
              >
                <span>{sessionTitle(chat.title)}</span>
              </SidebarMenuButton>
              {props.status(chat)}
            </SidebarMenuItem>
          ))}
          <ShowMore open={more} rest={props.group.chats.length - shown} onToggle={() => setMore(!more)} />
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

// oxlint-disable-next-line ren/no-comments -- The sidebar's chats under their spaces. A space's row opens and closes its chats; five show until Show more.
export function GroupedChats(props: {
  chats: ReadonlyArray<SessionInfo>
  spaces: ReadonlyArray<SpaceInfo>
  path: string
  rowClass: string
  status: (chat: SessionInfo) => React.ReactNode
}) {
  return (
    <li>
      <ul className="flex flex-col gap-2">
        {groupsOf(props.chats, props.spaces).map((group) => (
          <SpaceGroup
            key={group.spaceId}
            group={group}
            path={props.path}
            rowClass={props.rowClass}
            status={props.status}
          />
        ))}
      </ul>
    </li>
  )
}
