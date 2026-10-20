import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import { Effect, Schema } from "effect"
import { RouteError } from "../../../../../components/error-page.js"

export const Route = createFileRoute("/_authed/_shell/sessions/$sessionId/")({
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({
      message: Schema.optionalKey(SessionMessage.ID.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
      part: Schema.optionalKey(Schema.NonEmptyString.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
      child: Schema.optionalKey(Session.ID.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
    }),
  ),
  loader: (options) =>
    options.context.queryClient.query(
      options.context.api.session.get.queryOptions({ idOrSlug: options.params.sessionId }),
    ),
  head: (options) => ({ meta: [{ title: `${options.loaderData?.title ?? "Chat"} · Ren` }] }),
  errorComponent: (props) => <RouteError error={props.error} />,
  component: lazyRouteComponent(() => import("../../../../../features/session/session-page.js"), "SessionPage"),
})
