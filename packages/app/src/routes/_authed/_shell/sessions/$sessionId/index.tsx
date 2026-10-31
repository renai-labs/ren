import type { SessionInfo } from "@ren/client"
import { Skeleton } from "@ren/ui/skeleton"
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import { Effect, Schema } from "effect"
import { RouteError } from "../../../../../components/error-page.js"
import { addRepositories } from "../../-add-repositories.js"
import { Loader } from "../../../../../lib/loader.js"
import { Seed } from "../../../../../lib/seed.js"
import { SessionList } from "../../../../../lib/session-list.js"

export const Route = createFileRoute("/_authed/_shell/sessions/$sessionId/")({
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({
      message: Schema.optionalKey(SessionMessage.ID.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
      part: Schema.optionalKey(Schema.NonEmptyString.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
      child: Schema.optionalKey(Session.ID.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
    }),
  ),
  loader: async (options) => {
    const context = options.context
    const session = context.api.session.get.queryOptions({ idOrSlug: options.params.sessionId })
    Loader.start(
      context.queryClient.query({
        ...session,
        ...Seed.fromList<SessionInfo>(
          context.queryClient,
          [context.api.session.list.queryKey(), SessionList.sidebarKey],
          options.params.sessionId,
        ),
      }),
    )
    // oxlint-disable-next-line ren/no-comments -- The router preloads only the route's own component; SessionRoute renders SessionPage, so the loader loads it, and it never suspends in a render.
    await SessionPage.preload?.()
    return context.queryClient.getQueryData<SessionInfo>(session.queryKey)
  },
  head: (options) => ({ meta: [{ title: `${options.loaderData?.title ?? "Chat"} · Ren` }] }),
  pendingComponent: () => (
    <div className="flex min-h-0 flex-1 flex-col justify-end px-4 pb-4">
      <output className="sr-only">Loading</output>
      <Skeleton className="mx-auto h-28 w-full max-w-content rounded-2xl" />
    </div>
  ),
  errorComponent: (props) => <RouteError error={props.error} />,
  component: SessionRoute,
})

const SessionPage = lazyRouteComponent(() => import("../../../../../features/session/session-page.js"), "SessionPage")

function SessionRoute() {
  return <SessionPage addRepositories={addRepositories} />
}
