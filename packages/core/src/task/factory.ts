export * as TaskFactory from "./factory.js"

import type { Factory } from "@ren/schema/factory"
import { Struct } from "effect"

export const keep = (factory: Factory.Info, usable: ReadonlyArray<string>): Factory.Info => {
  const allowed = new Set(usable)
  const kept = factory.agents.filter((entry) => allowed.has(entry.agentId))
  if (kept.length === 0) return { maxHandoffs: factory.maxHandoffs, agents: usable.map((agentId) => ({ agentId })) }
  return {
    maxHandoffs: factory.maxHandoffs,
    agents: kept.map((entry) =>
      Struct.evolve(entry, {
        to: (to) =>
          (to ?? [])
            .filter((edge) => allowed.has(edge.agentId))
            .map((edge) => (!edge.else || allowed.has(edge.else) ? edge : Struct.omit(edge, ["else"]))),
      }),
    ),
  }
}
