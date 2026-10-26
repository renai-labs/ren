import { useState } from "react"
import type { MouseEvent } from "react"

export type PendingLink = { sourceId: string; targetId: string }

export function useConnectionInteraction(options: {
  targetY: Map<string, number>
  linkBySource: Map<string, string>
  sourceByTarget: Map<string, string>
  allowSharedTargets: boolean
  onConnect: (sourceId: string, targetId: string) => void | Promise<void>
  resetScroll: () => void
  boardWidth: number
  projectEdge: number
}) {
  const [armedTargetId, setArmedTargetId] = useState<string | null>(null)
  const [pendingLink, setPendingLink] = useState<PendingLink | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)

  const drop = () => {
    setArmedTargetId(null)
    setPointer(null)
  }

  return {
    armedTargetId,
    pendingLink,
    pointer,
    drop,
    armTarget: (targetId: string) => {
      if (!options.allowSharedTargets && options.sourceByTarget.has(targetId)) return
      setArmedTargetId((current) => (current === targetId ? null : targetId))
      const y = options.targetY.get(targetId)
      setPointer(y === undefined ? null : { x: options.projectEdge, y })
    },
    connectSource: async (sourceId: string) => {
      if (!armedTargetId || options.linkBySource.has(sourceId)) return
      setPendingLink({ sourceId, targetId: armedTargetId })
      drop()
      await Promise.resolve(options.onConnect(sourceId, armedTargetId))
        .then(() => options.resetScroll())
        .finally(() => setPendingLink(null))
    },
    trackPointer: (event: MouseEvent<HTMLElement>) => {
      if (!armedTargetId) return
      const rect = event.currentTarget.getBoundingClientRect()
      setPointer({
        x: ((event.clientX - rect.left) / rect.width) * options.boardWidth,
        y: event.clientY - rect.top,
      })
    },
  }
}
