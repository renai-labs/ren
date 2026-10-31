import { FactoryKanban } from "@/factory/factory-view"
import { useSpace } from "@/routes/space/use-space"

export function SpaceKanbanTab() {
  return <FactoryKanban space={useSpace()} />
}
