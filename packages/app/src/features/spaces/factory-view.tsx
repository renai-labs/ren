import { useShapeId } from "../../components/page.js"
import { Loading } from "@ren/ui/loading"
import type { SpaceInfo } from "@ren/client"
import { FactoryAnalytics } from "@ren/ui/factory-analytics"
import { useFactory } from "./use-factory.js"

export function FactoryDashboard(props: { space: SpaceInfo }) {
  const factory = useFactory(props.space)
  const shapeId = useShapeId("factory-analytics")
  return (
    <div className="flex min-h-150 flex-1 flex-col">
      <Loading
        id={shapeId}
        loading={factory.loading}
        label="Loading factory analytics"
        className="flex flex-1 flex-col"
      >
        <FactoryAnalytics world={factory.world} analytics={factory.analytics} />
      </Loading>
    </div>
  )
}
