export * as FactoryLine from "./factory-line.js"

import type { Infra } from "@ren/schema/infra"

export interface Station {
  readonly name: string
  readonly column: number
  readonly row: number
  readonly rows: number
  readonly maxRuns?: number | undefined
  readonly canFinish: boolean
  readonly toAnyone: boolean
  readonly isStart: boolean
}

export interface Route {
  readonly from: string
  readonly to: string | undefined
  readonly fromColumn: number
  readonly toColumn: number
  readonly kind: "next" | "skip" | "back"
  readonly side: "above" | "below"
  readonly lane: number
  readonly max?: number | undefined
  readonly start?: "new" | "continue" | undefined
  readonly fallback?: { readonly agent: string; readonly max: number } | undefined
  readonly isFallbackOnly: boolean
}

export interface Line {
  readonly stations: ReadonlyArray<Station>
  readonly routes: ReadonlyArray<Route>
  readonly loose: ReadonlyArray<Station>
  readonly columns: number
  readonly rows: number
  readonly lanesAbove: number
  readonly lanesBelow: number
  readonly maxHandoffs: number
  readonly hasFinish: boolean
}

const lanes = (routes: ReadonlyArray<Omit<Route, "lane">>) => {
  const placed: Array<{ readonly low: number; readonly high: number; readonly lane: number }> = []
  return new Map(
    routes
      .map((route) => ({
        route,
        low: Math.min(route.fromColumn, route.toColumn),
        high: Math.max(route.fromColumn, route.toColumn),
      }))
      .toSorted((a, b) => a.high - a.low - (b.high - b.low) || a.low - b.low)
      .map((arc) => {
        const lane =
          1 +
          Math.max(0, ...placed.filter((each) => each.low < arc.high && arc.low < each.high).map((each) => each.lane))
        placed.push({ low: arc.low, high: arc.high, lane })
        return [arc.route, lane] as const
      }),
  )
}

export const layout = (declaration: Infra.FactoryDeclaration): Line => {
  const entries = declaration.agents
  const targets = new Set(
    entries.flatMap((entry) =>
      (entry.to ?? []).flatMap((edge) => (edge.else ? [edge.agent, edge.else] : [edge.agent])),
    ),
  )
  const onLine = entries.filter((entry) => entry.to !== undefined || targets.has(entry.agent))
  const out = new Map(
    onLine.map((entry) => {
      const listed = entry.to ?? []
      const fallback = (agent: string): Route["fallback"] => {
        const limited = listed.find((edge) => edge.else === agent)
        return limited?.max ? { agent: limited.agent, max: limited.max } : undefined
      }
      const fallbackOnly = [
        ...new Set(
          listed.flatMap((edge) =>
            edge.else && !listed.some((other) => other.agent === edge.else) ? [edge.else] : [],
          ),
        ),
      ]
      return [
        entry.agent,
        [
          ...listed.map((edge) => ({
            agent: edge.agent,
            max: edge.max,
            start: edge.start,
            fallback: fallback(edge.agent),
            isFallbackOnly: false,
          })),
          ...fallbackOnly.map((agent) => ({
            agent,
            max: undefined,
            start: undefined,
            fallback: fallback(agent),
            isFallbackOnly: true,
          })),
        ],
      ] as const
    }),
  )
  const index = new Map(onLine.map((entry, position) => [entry.agent, position]))
  const layer = new Map<string, number>()
  const spread = (frontier: ReadonlyArray<string>, depth: number): void => {
    if (frontier.length === 0) return
    for (const name of frontier) layer.set(name, depth)
    const next = new Set(
      frontier.flatMap((name) => (out.get(name) ?? []).map((edge) => edge.agent)).filter((name) => !layer.has(name)),
    )
    spread([...next], depth + 1)
  }
  spread(
    onLine.filter((entry) => !targets.has(entry.agent)).map((entry) => entry.agent),
    0,
  )
  for (const entry of onLine) if (!layer.has(entry.agent)) spread([entry.agent], 0)
  const rank = (name: string) => [layer.get(name) ?? 0, index.get(name) ?? 0] as const
  const isSendBack = (from: string, to: string) => {
    const a = rank(from)
    const b = rank(to)
    return b[0] < a[0] || (b[0] === a[0] && b[1] < a[1])
  }
  const order = onLine
    .map((entry) => entry.agent)
    .toSorted((a, b) => rank(a)[0] - rank(b)[0] || rank(a)[1] - rank(b)[1])
  const column = new Map(order.map((name) => [name, 0]))
  for (const name of order)
    for (const edge of out.get(name) ?? [])
      if (!isSendBack(name, edge.agent))
        column.set(edge.agent, Math.max(column.get(edge.agent) ?? 0, (column.get(name) ?? 0) + 1))
  const at = (name: string) => column.get(name) ?? 0
  const columns = Math.max(0, ...order.map(at)) + 1
  const byColumn = Array.from({ length: columns }, (_, index) => order.filter((name) => at(name) === index))
  const finishers = onLine.filter((entry) => entry.finish || entry.to === undefined)
  const finishColumn = Math.max(columns, ...finishers.map((entry) => at(entry.agent) + 1))
  const isUpper = (name: string) => {
    const names = byColumn[at(name)] ?? []
    return names.indexOf(name) < (names.length - 1) / 2
  }
  const forward = (from: string, toColumn: number) => (toColumn - at(from) === 1 ? "next" : "skip")
  const unplaced: Array<Omit<Route, "lane">> = [
    ...onLine.flatMap((entry) =>
      (out.get(entry.agent) ?? []).map((edge) => {
        const isBack = isSendBack(entry.agent, edge.agent)
        return {
          from: entry.agent,
          to: edge.agent,
          fromColumn: at(entry.agent),
          toColumn: at(edge.agent),
          kind: isBack ? "back" : forward(entry.agent, at(edge.agent)),
          side: isBack && !isUpper(edge.agent) ? "below" : "above",
          max: edge.max,
          start: edge.start,
          fallback: edge.fallback,
          isFallbackOnly: edge.isFallbackOnly,
        } as const
      }),
    ),
    ...finishers.map(
      (entry) =>
        ({
          from: entry.agent,
          to: undefined,
          fromColumn: at(entry.agent),
          toColumn: finishColumn,
          kind: forward(entry.agent, finishColumn),
          side: "above",
          isFallbackOnly: false,
        }) as const,
    ),
  ]
  const above = lanes(unplaced.filter((route) => route.kind !== "next" && route.side === "above"))
  const below = lanes(unplaced.filter((route) => route.kind !== "next" && route.side === "below"))
  const routes = unplaced.map((route) => Object.assign(route, { lane: above.get(route) ?? below.get(route) ?? 0 }))
  const station = (
    entry: Infra.FactoryDeclaration["agents"][number],
    placed: { column: number; row: number; rows: number },
  ) => ({
    name: entry.agent,
    ...placed,
    maxRuns: entry.maxRuns,
    canFinish: Boolean(entry.finish) || entry.to === undefined,
    toAnyone: entry.to === undefined,
    isStart: !targets.has(entry.agent),
  })
  return {
    stations: onLine.map((entry) =>
      station(entry, {
        column: at(entry.agent),
        row: byColumn[at(entry.agent)]?.indexOf(entry.agent) ?? 0,
        rows: byColumn[at(entry.agent)]?.length ?? 1,
      }),
    ),
    routes,
    loose: entries
      .filter((entry) => !onLine.includes(entry))
      .map((entry, index) => station(entry, { column: index, row: 0, rows: 1 })),
    columns: finishers.length > 0 ? finishColumn + 1 : columns,
    rows: Math.max(1, ...byColumn.map((names) => names.length)),
    lanesAbove: Math.max(0, ...above.values()),
    lanesBelow: Math.max(0, ...below.values()),
    maxHandoffs: declaration.maxHandoffs,
    hasFinish: finishers.length > 0,
  }
}
