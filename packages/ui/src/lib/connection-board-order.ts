export type OrderableRow = { id: string }
type OrderableLink = { sourceId: string; targetId: string }

export function tidyBoardOrder<Target extends OrderableRow, Source extends OrderableRow>(
  targets: Target[],
  sources: Source[],
  links: OrderableLink[],
): { targets: Target[]; sources: Source[] } {
  const targetIdBySourceId = new Map(links.map((link) => [link.sourceId, link.targetId]))
  const linkedTargetIds = new Set(links.map((link) => link.targetId))
  const orderedTargets = [
    ...targets.filter((target) => linkedTargetIds.has(target.id)),
    ...targets.filter((target) => !linkedTargetIds.has(target.id)),
  ]
  const targetRank = new Map(orderedTargets.map((target, index) => [target.id, index]))
  const rankOf = (source: OrderableRow) => targetRank.get(targetIdBySourceId.get(source.id) ?? "") ?? 0
  return {
    targets: orderedTargets,
    sources: [
      ...sources.filter((source) => targetIdBySourceId.has(source.id)).toSorted((a, b) => rankOf(a) - rankOf(b)),
      ...sources.filter((source) => !targetIdBySourceId.has(source.id)),
    ],
  }
}
