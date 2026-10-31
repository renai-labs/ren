import type { SpaceInfo } from "@ren/client"
import { useEffect, useState } from "react"
import { FactoryAnalytics } from "./analytics"
import { FactoryBoard } from "./board"
import { useFactory } from "./use-factory"

const COMPACT_QUERY = "(max-width: 767px)"

function useCompact() {
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_QUERY).matches)
  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY)
    const update = () => setCompact(query.matches)
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])
  return compact
}

export function FactoryDashboard(props: { space: SpaceInfo }) {
  const factory = useFactory(props.space)
  return (
    <div className="flex min-h-150 flex-1 flex-col">
      <FactoryAnalytics world={factory.world} analytics={factory.analytics} compact={useCompact()} />
    </div>
  )
}

export function FactoryKanban(props: { space: SpaceInfo }) {
  const factory = useFactory(props.space)
  return (
    <div className="-mx-8 flex min-h-150 flex-1 flex-col">
      <FactoryBoard
        world={factory.world}
        spend={factory.spend}
        onAct={factory.act}
        onOpen={factory.open}
        compact={useCompact()}
        startAt="backlog"
      />
    </div>
  )
}
