import type { SessionInfo } from "@ren/client"
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import { Effect, Schema } from "effect"
import { lazy, Suspense } from "react"
import { RouteError } from "../../../../../components/error-page.js"
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
    // oxlint-disable-next-line ren/no-comments -- The router preloads only the route's own component; SessionRoute renders SessionPage, so the loader loads it, and it never suspends in a render.
    await SessionPage.preload?.()
    return options.context.queryClient.query({
      ...options.context.api.session.get.queryOptions({ idOrSlug: options.params.sessionId }),
      ...Seed.fromList<SessionInfo>(
        options.context.queryClient,
        [options.context.api.session.list.queryKey(), SessionList.sidebarKey],
        options.params.sessionId,
      ),
    })
  },
  head: (options) => ({ meta: [{ title: `${options.loaderData?.title ?? "Chat"} · Ren` }] }),
  errorComponent: (props) => <RouteError error={props.error} />,
  component: SessionRoute,
})

const SessionPage = lazyRouteComponent(() => import("../../../../../features/session/session-page.js"), "SessionPage")

const AddRepositories = lazy(() =>
  import("../../../../../features/spaces/add-repositories-dialog.js").then((module) => ({
    default: module.SpaceAddRepositories,
  })),
)

function SessionRoute() {
  return (
    <SessionPage
      addRepositories={(props) => (
        <Suspense fallback={null}>
          <AddRepositories spaceId={props.spaceId} onClose={props.onClose} />
        </Suspense>
      )}
    />
  )
}
