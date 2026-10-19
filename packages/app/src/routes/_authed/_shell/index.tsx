import { createFileRoute } from "@tanstack/react-router"
import { NewChat } from "../../../features/session/new-chat.js"

export const Route = createFileRoute("/_authed/_shell/")({
  head: () => ({ meta: [{ title: "New chat · Ren" }] }),
  component: NewChatRoute,
})

function NewChatRoute() {
  const context = Route.useRouteContext()
  return <NewChat name={context.me.user.name} />
}
