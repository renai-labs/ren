import { createRootRouteWithContext, HeadContent, Outlet } from "@tanstack/react-router"
import { RouteError, RouteNotFound } from "../components/error-page.js"
import type { Runtime } from "../lib/runtime.js"

export const Route = createRootRouteWithContext<Runtime.Context>()({
  head: () => ({ meta: [{ title: "Ren" }] }),
  component: Root,
  errorComponent: (props) => <RouteError error={props.error} />,
  notFoundComponent: RouteNotFound,
})

function Root() {
  return (
    <>
      <HeadContent />
      <Outlet />
    </>
  )
}
