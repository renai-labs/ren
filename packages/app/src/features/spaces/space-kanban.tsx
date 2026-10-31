import { FactoryKanban } from "./factory-view.js"
import { useSpace } from "./use-space.js"

export function SpaceKanbanTab() {
  return <FactoryKanban space={useSpace()} />
}
