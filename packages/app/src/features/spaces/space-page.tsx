import type { SpaceInfo } from "@ren/client"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@ren/ui/alert"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Icon } from "@ren/ui/icon"
import { Button } from "@ren/ui/button"
import { Page } from "@ren/ui/page"
import { Skeleton } from "@ren/ui/skeleton"
import { toast } from "@ren/ui/toast"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useNavigate, useRouteContext, useRouterState } from "@tanstack/react-router"
import { useState } from "react"
import type { ReactNode } from "react"
import { Loader } from "../../lib/loader.js"
import { RouterContext } from "../../lib/router-context.js"
import { SpaceSections } from "./space-sections.js"

export function SpacePage(props: { spaceId: string; children: ReactNode }) {
  const context = RouterContext.useRouterContext()
  const authed = useRouteContext({ from: "/_authed" })
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const space = useQuery({ ...context.api.space.get.queryOptions({ idOrSlug: props.spaceId }), ...Loader.required })
  const join = useMutation(context.api["space-member"].create.mutationOptions())
  if (!space.data) return <Page.Pending description={<Skeleton className="h-4 w-64" />} />
  const isMember = Boolean(space.data.membershipId)
  const userId = authed.me.user.id
  const section = SpaceSections.of(pathname)
  return (
    <Page.Root
      title={section.label}
      description={section.description(space.data.name)}
      menu={space.data.canArchive ? <SpaceMenu space={space.data} /> : undefined}
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
    </Page.Root>
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
