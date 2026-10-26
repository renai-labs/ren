import { useState } from "react"
import type { RefObject } from "react"
import { tidyBoardOrder } from "./connection-board-order.js"
import type { OrderableRow } from "./connection-board-order.js"

type Row = OrderableRow & { title: string }

function filterRows<R extends Row>(rows: R[], query: string) {
  const normalized = query.trim().toLocaleLowerCase()
  return normalized ? rows.filter((row) => row.title.toLocaleLowerCase().includes(normalized)) : rows
}

export function useConnectionSearch<Target extends Row, Source extends Row>(
  targets: Target[],
  sources: Source[],
  links: { sourceId: string; targetId: string }[],
  sourceListRef: RefObject<HTMLElement | null>,
  targetListRef: RefObject<HTMLElement | null>,
) {
  const [sourceQuery, setSourceQuery] = useState("")
  const [targetQuery, setTargetQuery] = useState("")
  const [sourceScrollTop, setSourceScrollTop] = useState(0)
  const [targetScrollTop, setTargetScrollTop] = useState(0)

  const ordered = tidyBoardOrder(targets, sources, links)

  const syncScroll = (top: number) => {
    if (sourceListRef.current) sourceListRef.current.scrollTop = top
    if (targetListRef.current) targetListRef.current.scrollTop = top
    setSourceScrollTop(sourceListRef.current?.scrollTop ?? top)
    setTargetScrollTop(targetListRef.current?.scrollTop ?? top)
  }

  return {
    visibleSources: filterRows(ordered.sources, sourceQuery),
    visibleTargets: filterRows(ordered.targets, targetQuery),
    sourceQuery,
    targetQuery,
    sourceScrollTop,
    targetScrollTop,
    syncScroll,
    resetScroll: () => syncScroll(0),
    searchSources: (query: string) => {
      setSourceQuery(query)
      syncScroll(0)
    },
    searchTargets: (query: string) => {
      setTargetQuery(query)
      syncScroll(0)
    },
  }
}
