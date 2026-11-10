import { createFileRoute } from "@tanstack/react-router"
import { SpaceComputeTab } from "../../../../../features/environments/space-compute.js"
import { useSpace } from "../../../../../features/spaces/use-space.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/compute")({
  head: () => ({ meta: [{ title: "Compute · Space · Ren" }] }),
  wrapInSuspense: false,
  component: Compute,
})

function Compute() {
  return <SpaceComputeTab space={useSpace()} />
}
