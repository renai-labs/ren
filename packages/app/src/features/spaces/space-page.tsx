import type { SpaceInfo } from "@ren/client"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@ren/ui/alert"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@ren/ui/breadcrumb"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Icon } from "@ren/ui/icon"
import { Button, buttonVariants } from "@ren/ui/button"
import { PageShell } from "@ren/ui/page-shell"
import { toast } from "@ren/ui/toast"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useRouteContext } from "@tanstack/react-router"
import { useState } from "react"
import type { ReactNode } from "react"
import { RouterContext } from "../../lib/router-context.js"

const tabLink = buttonVariants({
  variant: "ghost",
  className:
    "font-normal text-muted-foreground aria-[current=page]:bg-secondary aria-[current=page]:font-medium aria-[current=page]:text-foreground",
})

export function SpacePage(props: { spaceId: string; children: ReactNode }) {
  const context = RouterContext.useRouterContext()
  const authed = useRouteContext({ from: "/_authed" })
  const space = useQuery(context.api.space.get.queryOptions({ idOrSlug: props.spaceId }))
  const join = useMutation(context.api["space-member"].create.mutationOptions())
  if (!space.data) return null
  const params = { spaceId: props.spaceId }
  const isMember = Boolean(space.data.membershipId)
  const userId = authed.me.user.id
  return (
    <PageShell.Root
      layout="detail"
      heading="entity"
      context={
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link to="/spaces" />}>Spaces</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{space.data.name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
      media={
        <span className="flex size-12 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
          <Icon glyph={space.data.kind === "private" ? "Lock" : "Cube"} size="extra-large" />
        </span>
      }
      title={space.data.name}
      subtitle={space.data.description ?? undefined}
      actions={space.data.canArchive ? <SpaceMenu space={space.data} /> : undefined}
      navigation={
        isMember ? (
          <nav aria-label={space.data.name} className="flex flex-wrap items-center gap-1">
            <Link to="/spaces/$spaceId" params={params} activeOptions={{ exact: true }} className={tabLink}>
              Overview
            </Link>
            <Link to="/spaces/$spaceId/members" params={params} className={tabLink}>
              Members
              <span className="text-muted-foreground tabular-nums">{space.data.memberCount}</span>
            </Link>
            <Link to="/spaces/$spaceId/apps" params={params} className={tabLink}>
              Apps
            </Link>
            <Link to="/spaces/$spaceId/credentials" params={params} className={tabLink}>
              Credentials
            </Link>
            <Link to="/spaces/$spaceId/channels" params={params} className={tabLink}>
              Channels
            </Link>
            <Link to="/spaces/$spaceId/repositories" params={params} className={tabLink}>
              Repositories
            </Link>
            <Link to="/spaces/$spaceId/factory" params={params} className={tabLink}>
              Factory
            </Link>
          </nav>
        ) : undefined
      }
    >
      {isMember ? (
        props.children
      ) : (
        // oxlint-disable-next-line ren/no-comments, jsx-a11y/prefer-tag-over-role -- access AC4: a non-member sees the list entry and may join a shared space. Alert renders a div, and the notice is a status.
        <Alert role="status" className="has-data-[slot=alert-action]:pr-26">
          <Icon glyph="Info" />
          <AlertTitle>
            {space.data.kind === "private" ? "This is a private space" : "You are not a member of this space"}
          </AlertTitle>
          <AlertDescription>
            {space.data.kind === "private"
              ? "Only its owner sees its chats, tasks, files and settings."
              : "Join it to see its chats, tasks and settings. Its members see you in the member list once you join."}
          </AlertDescription>
          {space.data.canJoin ? (
            <AlertAction>
              <Button
                size="sm"
                disabled={join.isPending}
                onClick={() => join.mutate({ payload: { spaceId: props.spaceId, userId } })}
              >
                Join space
              </Button>
            </AlertAction>
          ) : null}
        </Alert>
      )}
    </PageShell.Root>
  )
}

function SpaceMenu(props: { space: SpaceInfo }) {
  const context = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const archive = useMutation(context.api.space.archive.mutationOptions())
  const [confirming, setConfirming] = useState(false)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Space actions" />
          }
        >
          <Icon glyph="MoreHorizontal" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onClick={() => setConfirming(true)}>
              <Icon glyph="Archive" />
              Archive space
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmationDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Archive “${props.space.name}”?`}
        description="Its members lose access. Only the API can bring it back."
        confirmLabel="Archive"
        tone="danger"
        onConfirm={async () => {
          await archive.mutateAsync({ id: props.space.id })
        }}
        onConfirmed={() => {
          toast.add({ type: "success", title: `${props.space.name} archived` })
          void navigate({ to: "/spaces" })
        }}
      />
    </>
  )
}
