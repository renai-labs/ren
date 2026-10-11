import { createRootRouteWithContext, Outlet } from "@tanstack/react-router"
import type { Runtime } from "../lib/runtime.js"

export const Route = createRootRouteWithContext<Runtime.Context>()({
  component: Outlet,
  errorComponent: (props) => (
    <main role="alert">{props.error instanceof Error ? props.error.message : "Something went wrong"}</main>
  ),
  notFoundComponent: () => <main>Not found</main>,
})
