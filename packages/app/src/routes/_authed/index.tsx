import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authed/")({
  head: () => ({ meta: [{ title: "Home · Ren" }] }),
  component: Home,
})

function Home() {
  const context = Route.useRouteContext()
  return <main>{context.session.user.name}</main>
}
