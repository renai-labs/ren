import { PageShell } from "@ren/ui/page-shell"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authed/_shell/sessions/")({
  head: () => ({ meta: [{ title: "New chat · Ren" }] }),
  component: NewChat,
})

function NewChat() {
  const context = Route.useRouteContext()
  return <PageShell.Root title={`Welcome, ${context.me.user.name}`}>{null}</PageShell.Root>
}
