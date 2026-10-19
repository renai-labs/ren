import { Session } from "@ren/schema/session"
import { createFileRoute } from "@tanstack/react-router"
import { RouteError } from "../../../../../components/error-page.js"
import { SessionChat } from "../../../../../features/session/session-chat.js"

export const Route = createFileRoute("/_authed/_shell/sessions/$sessionId/")({
  loader: (options) =>
    options.context.queryClient.query(
      options.context.api.session.get.queryOptions({ idOrSlug: options.params.sessionId }),
    ),
  head: (options) => ({ meta: [{ title: `${options.loaderData?.title ?? "Chat"} · Ren` }] }),
  errorComponent: (props) => <RouteError error={props.error} />,
  component: SessionRoute,
})

function SessionRoute() {
  const params = Route.useParams()
  return <SessionChat key={params.sessionId} sessionID={Session.ID.make(params.sessionId)} />
}
