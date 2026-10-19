import { createFileRoute, redirect } from "@tanstack/react-router"
import { Effect, Schema } from "effect"
import { NewChat } from "../../../features/session/new-chat.js"

export const Route = createFileRoute("/_authed/_shell/")({
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({
      prompt: Schema.optionalKey(Schema.String.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
    }),
  ),
  beforeLoad: async (options) => {
    const prompt = options.search.prompt
    if (prompt === undefined || options.preload) return
    const drafts = options.context.platform.drafts
    if (drafts && prompt.trim())
      (await import("../../../features/session/session-drafts.js")).SessionDrafts.prefill(drafts, prompt)
    throw redirect({ to: "/", search: {}, replace: true })
  },
  head: () => ({ meta: [{ title: "New chat · Ren" }] }),
  component: NewChatRoute,
})

function NewChatRoute() {
  const context = Route.useRouteContext()
  return <NewChat name={context.me.user.name} userId={context.me.user.id} />
}
