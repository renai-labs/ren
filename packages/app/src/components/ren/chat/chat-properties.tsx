import type { ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  IconApps,
  IconCalendar,
  IconChevronRight,
  IconCube,
  IconListDetails,
  IconSparkles,
  IconUserCircle,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { PersonAvatar } from "@/components/ren/person-avatar"
import { api } from "@/lib/api"
import { formatDate } from "@/lib/format"

function Property(props: { icon: ReactNode; label: string; children: ReactNode; to?: ReactNode | undefined }) {
  const body = (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-2.5 text-sm [&_svg]:size-4 [&_svg]:text-muted-foreground">
        {props.icon}
        {props.label}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">{props.children}</span>
    </>
  )
  return props.to ? (
    <div className="relative flex h-9 items-center gap-3 rounded-md px-2 hover:bg-muted has-focus-visible:bg-muted">
      {body}
      <IconChevronRight className="size-4 text-muted-foreground" />
      {props.to}
    </div>
  ) : (
    <div className="flex h-9 items-center gap-3 px-2">{body}</div>
  )
}

export function ChatProperties(props: {
  sessionId: string
  spaceId: string | undefined
  spaceName: string
  createdBy: { name: string; image?: string | undefined } | undefined
  createdAt: string | undefined
  model: string | undefined
}) {
  const reach = useQuery({
    ...api["app-profile-reach"].session.profiles.queryOptions({ id: props.sessionId }),
    retry: false,
  })
  const apps = new Set((reach.data?.profiles ?? []).map((profile) => profile.appId)).size
  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon" className="text-muted-foreground" aria-label="Properties" />}
      >
        <IconListDetails />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-0 p-1">
        <PopoverTitle className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">Properties</PopoverTitle>
        <Property icon={<IconUserCircle />} label="Created by">
          {props.createdBy ? (
            <>
              <PersonAvatar name={props.createdBy.name} image={props.createdBy.image} />
              <span className="truncate text-foreground">{props.createdBy.name}</span>
            </>
          ) : (
            "—"
          )}
        </Property>
        <Property
          icon={<IconCube />}
          label="Space"
          to={
            props.spaceId ? (
              <Link
                to="/spaces/$spaceId"
                params={{ spaceId: props.spaceId }}
                aria-label={`Open ${props.spaceName}`}
                className="absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            ) : undefined
          }
        >
          <span className="truncate">{props.spaceName}</span>
        </Property>
        <Property
          icon={<IconApps />}
          label="Active apps"
          to={
            props.spaceId ? (
              <Link
                to="/spaces/$spaceId/apps"
                params={{ spaceId: props.spaceId }}
                aria-label="Open the space’s apps"
                className="absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            ) : undefined
          }
        >
          <span className="tabular-nums">{apps}</span>
        </Property>
        <Property icon={<IconSparkles />} label="Model">
          <span className="truncate">{props.model ?? "—"}</span>
        </Property>
        <Property icon={<IconCalendar />} label="Created">
          {props.createdAt ? formatDate(props.createdAt) : "—"}
        </Property>
      </PopoverContent>
    </Popover>
  )
}
