export * as FactoryCheck from "./factory-check.js"

import type { Factory } from "./factory.js"

interface Shape {
  readonly agent: string
  readonly to?:
    | ReadonlyArray<{ readonly agent: string; readonly max?: number | undefined; readonly else?: string | undefined }>
    | undefined
}

export const issues = (agents: ReadonlyArray<Shape>, key: string) => {
  const known = new Set(agents.map((entry) => entry.agent))
  const first = new Map(agents.map((entry, index) => [entry.agent, index] as const).toReversed())
  const edges = agents.flatMap((entry, index) => {
    const listed = new Map((entry.to ?? []).map((edge, position) => [edge.agent, position] as const).toReversed())
    return (entry.to ?? []).map((edge, position) => ({
      from: entry.agent,
      edge,
      isRepeated: listed.get(edge.agent) !== position,
      path: ["agents", index, "to", position, key],
      elsePath: ["agents", index, "to", position, "else"],
    }))
  })
  const checks = [
    ...agents.map((entry, index) => ({
      failed: first.get(entry.agent) !== index,
      path: ["agents", index, key],
      issue: `${entry.agent} is in the factory twice.`,
    })),
    ...edges.flatMap((found) => [
      {
        failed: !known.has(found.edge.agent),
        path: found.path,
        issue: `${found.edge.agent} is not in the factory.`,
      },
      {
        failed: found.edge.agent === found.from,
        path: found.path,
        issue: `${found.from} cannot hand off to itself.`,
      },
      { failed: found.isRepeated, path: found.path, issue: `${found.from} lists ${found.edge.agent} twice.` },
      {
        failed: Boolean(found.edge.else) && !found.edge.max,
        path: found.elsePath,
        issue: "An else needs a max.",
      },
      {
        failed: Boolean(found.edge.else) && !known.has(found.edge.else ?? ""),
        path: found.elsePath,
        issue: `${found.edge.else} is not in the factory.`,
      },
      {
        failed: found.edge.else === found.edge.agent,
        path: found.elsePath,
        issue: "The else agent must differ from the edge's agent.",
      },
    ]),
  ]
  return checks.filter((check) => check.failed).map((check) => ({ path: check.path, issue: check.issue }))
}

export const problems = (factory: Factory.Info) =>
  issues(
    factory.agents.map((entry) => ({
      agent: entry.agentId,
      to: entry.to?.map((edge) => ({ agent: edge.agentId, max: edge.max, else: edge.else })),
    })),
    "agentId",
  ).map((problem) => problem.issue)
