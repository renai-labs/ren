import { FactoryKanban } from "./factory-view.js"
import { PagePlaceholder } from "../../components/page-placeholder.js"
import { isSoftwareFactory } from "../../lib/factory.js"
import { useSpace } from "./use-space.js"

export function SpaceTasksTab() {
  const space = useSpace()
  if (isSoftwareFactory(space)) return <FactoryKanban space={space} />
  return <PagePlaceholder />
}
