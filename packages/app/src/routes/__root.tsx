import { createRootRouteWithContext, HeadContent, Outlet } from "@tanstack/react-router"
import { RouteError, RouteNotFound } from "../components/route-error.js"
import type { Runtime } from "../lib/runtime.js"

export const Route = createRootRouteWithContext<Runtime.Context>()({
  head: () => ({ meta: [{ title: "Ren" }] }),
  component: Root,
  errorComponent: RouteError,
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
