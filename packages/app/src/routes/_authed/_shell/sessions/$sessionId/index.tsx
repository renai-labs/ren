import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router"
import { RouteError } from "../../../../../components/error-page.js"

export const Route = createFileRoute("/_authed/_shell/sessions/$sessionId/")({
  loader: (options) =>
    options.context.queryClient.query(
      options.context.api.session.get.queryOptions({ idOrSlug: options.params.sessionId }),
    ),
  head: (options) => ({ meta: [{ title: `${options.loaderData?.title ?? "Chat"} · Ren` }] }),
  errorComponent: (props) => <RouteError error={props.error} />,
  component: lazyRouteComponent(() => import("../../../../../features/session/session-page.js"), "SessionPage"),
})
