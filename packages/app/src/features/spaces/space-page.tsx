import { Suspense } from "react"
import { SpaceSectionSkeleton, spaceSections } from "../../components/route-skeleton.js"
import { useMutation } from "@tanstack/react-query"
import { Outlet } from "@tanstack/react-router"
import type { SpaceInfo } from "@ren/client"
import { Button } from "@ren/ui/button"
import { Spinner } from "@ren/ui/spinner"
import { toast } from "@ren/ui/sonner"
import { EmptyState } from "../../components/empty-state.js"
import { Page } from "../../components/page.js"
import { errorMessage } from "../../lib/errors.js"
import { isSoftwareFactory } from "../../lib/factory.js"
import { RouterContext } from "../../lib/router-context.js"
import { useMe } from "../../lib/use-me.js"
import { AskToJoin } from "./ask-to-join.js"
import { useSpace } from "./use-space.js"
import { Routing } from "../../lib/routing.js"

const sharedReason = (space: SpaceInfo) => {
  if (space.canJoin) return "Join to see its chats, tasks, files and apps."
  if (space.joinRequestId) return "Your request is waiting for a member of this space to answer."
  if (space.canRequestJoin) return "Ask to join to see its chats, tasks, files and apps."
  return "Its chats, tasks, files and apps are visible to its members."
}

function NotJoined(props: { space: SpaceInfo }) {
  const { api } = RouterContext.useRouterContext()
  const me = useMe()
  const join = useMutation(api["space-member"].create.mutationOptions())
  const space = props.space
  const reason = space.kind === "private" ? "Only its owner can open it." : sharedReason(space)
  return (
    <Page title={space.name} description={space.description ?? undefined}>
      <EmptyState
        title={space.kind === "private" ? "This is a private space" : "You’re not in this space"}
        action={
          space.canJoin ? (
            <Button
              disabled={join.isPending}
              onClick={() =>
                join.mutate(
                  { payload: { spaceId: space.id, userId: me.user.id } },
                  {
                    onSuccess: () => toast.success(`Joined ${space.name}`),
                    onError: (error) => toast.error("Could not join the space", { description: errorMessage(error) }),
                  },
                )
              }
            >
              {join.isPending ? <Spinner data-icon="inline-start" /> : null}
              Join space
            </Button>
          ) : (
            <AskToJoin space={space} />
          )
        }
      >
        {reason}
      </EmptyState>
    </Page>
  )
}

const ownPages = new Set(["tasks"])

export function SpaceLayout() {
  const space = useSpace()
  const path = Routing.useRenderedPath().split("/")
  const tab = path.at(3) ?? "inbox"
  const factory = tab === "overview" && isSoftwareFactory(space)
  const section = spaceSections[tab] ?? spaceSections.inbox
  if (space.membershipId === null) return <NotJoined space={space} />
  if (factory)
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col px-8 pt-2">
        <Suspense fallback={<SpaceSectionSkeleton />}>
          <Outlet />
        </Suspense>
      </div>
    )
  if (ownPages.has(tab) || ((tab === "automations" || tab === "agents") && path.at(4) !== undefined))
    return (
      <Suspense fallback={<SpaceSectionSkeleton />}>
        <Outlet />
      </Suspense>
    )
  return (
    <Page title={section.title} description={section.description?.(space.name)} width={section.width}>
      <Suspense fallback={<SpaceSectionSkeleton />}>
        <Outlet />
      </Suspense>
    </Page>
  )
}
