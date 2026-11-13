import { useShapeId } from "../../components/page.js"
import { Loading } from "@ren/ui/loading"
import type { SpaceInfo } from "@ren/client"
import { FactoryAnalytics } from "@ren/ui/factory-analytics"
import { FactoryBoard } from "@ren/ui/factory-board"
import { Schema } from "effect"
import { Preference } from "../../lib/preference.js"
import { useFactory } from "./use-factory.js"

const stacksPreference = Preference.make("factory.stacks.v1", Schema.Record(Schema.String, Schema.Boolean), {})

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

export function FactoryKanban(props: { space: SpaceInfo }) {
  const factory = useFactory(props.space)
  const stacks = Preference.usePreference(stacksPreference)
  const setPreference = Preference.useSetPreference()
  const shapeId = useShapeId("factory-board")
  return (
    <div className="-mx-8 flex min-h-150 flex-1 flex-col">
      <Loading id={shapeId} loading={factory.loading} label="Loading task board" className="flex flex-1 flex-col">
        <FactoryBoard
          world={factory.world}
          spend={factory.spend}
          onAct={factory.act}
          onOpen={factory.open}
          startAt="backlog"
          stacks={stacks}
          onStackChange={(stage, options) => {
            setPreference(stacksPreference, { ...stacks, [stage]: options.expanded })
          }}
        />
      </Loading>
    </div>
  )
}
