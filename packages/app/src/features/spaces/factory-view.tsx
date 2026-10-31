import type { SpaceInfo } from "@ren/client"
import { FactoryAnalytics } from "@ren/ui/factory-analytics"
import { FactoryBoard } from "@ren/ui/factory-board"
import { Schema } from "effect"
import { useState } from "react"
import { Preference } from "../../lib/preference.js"
import { Platform } from "../../platform/platform.js"
import { useFactory } from "./use-factory.js"

const stacksPreference = Preference.make("factory.stacks.v1", Schema.Record(Schema.String, Schema.Boolean), {})

export function FactoryDashboard(props: { space: SpaceInfo }) {
  const factory = useFactory(props.space)
  return (
    <div className="flex min-h-150 flex-1 flex-col">
      <FactoryAnalytics world={factory.world} analytics={factory.analytics} />
    </div>
  )
}

export function FactoryKanban(props: { space: SpaceInfo }) {
  const factory = useFactory(props.space)
  const platform = Platform.usePlatform()
  const [stacks, setStacks] = useState(() => stacksPreference.read(platform.storage))
  return (
    <div className="-mx-8 flex min-h-150 flex-1 flex-col">
      <FactoryBoard
        world={factory.world}
        spend={factory.spend}
        onAct={factory.act}
        onOpen={factory.open}
        startAt="backlog"
        stacks={stacks}
        onStackChange={(stage, options) => {
          const next = { ...stacks, [stage]: options.expanded }
          stacksPreference.write(platform.storage, next)
          setStacks(next)
        }}
      />
    </div>
  )
}
