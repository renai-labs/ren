import "./main.css"
import { createHashHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { LoadingProvider } from "@ren/ui/loading"
import { TooltipProvider } from "@ren/ui/tooltip"
import { createRoot } from "react-dom/client"
import { SkeletonPreview } from "./components/loading-preview.js"

if (!import.meta.env.DEV) throw new Error("Loading previews require the local dev server")
// oxlint-disable-next-line no-restricted-properties -- This dev host entry mounts React, like main.tsx.
const root = document.getElementById("root")
if (root === null) throw new Error("Missing #root element")
const route = createRootRoute({ component: SkeletonPreview })
const router = createRouter({
  history: createHashHistory(),
  routeTree: route.addChildren([
    createRoute({ getParentRoute: () => route, path: "/" }),
    createRoute({ getParentRoute: () => route, path: "$" }),
  ]),
})
createRoot(root).render(
  <TooltipProvider>
    <LoadingProvider>
      <RouterProvider router={router} />
    </LoadingProvider>
  </TooltipProvider>,
)
