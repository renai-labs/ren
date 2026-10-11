import { createRootRouteWithContext, HeadContent, Outlet } from "@tanstack/react-router"
import type { Runtime } from "../lib/runtime.js"

export const Route = createRootRouteWithContext<Runtime.Context>()({
  head: () => ({ meta: [{ title: "Ren" }] }),
  component: Root,
  errorComponent: (props) => (
    <main role="alert">
      {props.error instanceof Error ? props.error.message : "Unable to load this page. Reload to try again."}
    </main>
  ),
  notFoundComponent: () => <main>Not found</main>,
})

function Root() {
  return (
    <>
      <HeadContent />
      <Outlet />
    </>
  )
}
