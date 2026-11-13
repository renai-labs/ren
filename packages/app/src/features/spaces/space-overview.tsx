import { FactoryDashboard } from "./factory-view.js"
import { PagePlaceholder } from "../../components/page-placeholder.js"
import { isSoftwareFactory } from "../../lib/factory.js"
import { useSpace } from "./use-space.js"

export function SpaceOverviewTab() {
  const space = useSpace()
  if (isSoftwareFactory(space)) return <FactoryDashboard space={space} />
  return <PagePlaceholder />
}
