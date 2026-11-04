import { Navigate } from "@tanstack/react-router"
import { FactoryDashboard } from "./factory-view.js"
import { isSoftwareFactory } from "../../lib/factory.js"
import { useSpace } from "./use-space.js"

export function SpaceOverviewTab() {
  const space = useSpace()
  if (isSoftwareFactory(space)) return <FactoryDashboard space={space} />
  return <Navigate to="/spaces/$spaceId/settings" params={{ spaceId: space.id }} replace />
}
