import { LayoutGroup, MotionConfig, motion } from "motion/react"
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react"
import { cn } from "@/lib/utils"
import { deriveBoard, type BoardModel } from "./lib/board"
import type { InsightsRow } from "@ren/client"
import type { SPEND_STAGES } from "./lib/analytics"
import { withRealSpend } from "./lib/real"
import { STAGES, STAGE_TITLES, type FactoryWorld, type Resolution, type Stage } from "./lib/types"
import type { CardActions } from "./card"
import { StageColumn, type CardList, type DragHandlers } from "./column"
import { BoardIdsContext, MotionModeContext, type BoardIds, type MotionMode } from "./context"
import { useNow, useStackState } from "./use-factory"

type DropTarget = { kind: "promote" } | { kind: "reorder"; stage: Stage; list: CardList; before?: string }
type ColumnRefs = RefObject<Partial<Record<Stage, HTMLDivElement | null>>>
type Act = (taskId: string, resolution: Resolution, note?: string, before?: string) => void

function sameTarget(a: DropTarget | null, b: DropTarget | null) {
  if (a === b) return true
  if (!a || !b || a.kind !== b.kind) return false
  if (a.kind === "promote") return true
  return b.kind === "reorder" && a.stage === b.stage && a.list === b.list && a.before === b.before
}

function useCardDrag(input: { board: BoardModel; columnRefs: ColumnRefs; live: boolean; onAct: Act }) {
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const [slotHeight, setSlotHeight] = useState(84)

  const sourceOf = (taskId: string): { stage: Stage; list: CardList } | undefined => {
    for (const stage of STAGES) {
      if (input.board[stage].cards.some((card) => card.id === taskId)) return { stage, list: "cards" }
      if (input.board[stage].queue.some((card) => card.id === taskId)) return { stage, list: "queue" }
    }
    return undefined
  }

  const targetOf = (taskId: string, point: { x: number; y: number }): DropTarget | null => {
    const source = sourceOf(taskId)
    if (!source) return null
    const x = point.x - window.scrollX
    const y = point.y - window.scrollY
    const inside = (element: HTMLElement | null | undefined) => {
      const rect = element?.getBoundingClientRect()
      return Boolean(rect && x >= rect.left - 14 && x <= rect.right + 14 && y >= rect.top && y <= rect.bottom)
    }
    if (source.stage === "backlog" && inside(input.columnRefs.current.plan)) return { kind: "promote" }
    if (!inside(input.columnRefs.current[source.stage])) return null
    const items = [
      // oxlint-disable-next-line no-restricted-properties -- drop targets are found by their position on screen
      ...document.querySelectorAll<HTMLElement>(`[data-reorder-list="${source.stage}:${source.list}"]`),
    ].filter((element) => element.dataset.cardId !== taskId)
    const before = items.find((element) => {
      const rect = element.getBoundingClientRect()
      return y < rect.top + rect.height / 2
    })?.dataset.cardId
    return { kind: "reorder", stage: source.stage, list: source.list, ...(before && { before }) }
  }

  const drag: DragHandlers = {
    enabled: input.live,
    onDragStart: (taskId) => {
      // oxlint-disable-next-line no-restricted-properties -- the dragged card's height sizes the drop slot
      const element = document.querySelector<HTMLElement>(`[data-card-id="${taskId}"]`)
      setSlotHeight(element?.offsetHeight ?? 84)
    },
    onDrag: (taskId, point) => {
      const target = targetOf(taskId, point)
      setDropTarget((previous) => (sameTarget(previous, target) ? previous : target))
    },
    onDrop: (taskId, point) => {
      const target = targetOf(taskId, point)
      setDropTarget(null)
      if (!target) return
      if (target.kind === "promote") input.onAct(taskId, "promote")
      else input.onAct(taskId, "reorder", undefined, target.before)
    },
  }

  return { drag, dropTarget, slotHeight }
}

export function FactoryBoard({
  world,
  spend,
  onAct: act,
  onOpen,
  startAt,
  compact = false,
}: {
  world: FactoryWorld
  spend: Partial<Record<(typeof SPEND_STAGES)[number], ReadonlyArray<InsightsRow>>>
  onAct: Act
  onOpen: (taskId: string) => void
  startAt?: Stage
  compact?: boolean
}) {
  const now = useNow(1000)
  const scroller = useRef<HTMLDivElement>(null)
  const at = now
  const board = withRealSpend(deriveBoard(world, at), spend, at)
  const currentIds = new Set(
    Object.values(board).flatMap((column) => [...column.cards, ...column.queue].map((card) => card.id)),
  )
  const [ids, setIds] = useState<BoardIds>(() => ({ previous: new Set(), current: currentIds }))
  const changed = ids.current.size !== currentIds.size || [...currentIds].some((id) => !ids.current.has(id))
  if (changed) setIds({ previous: ids.current, current: currentIds })
  const columnRefs = useRef<Partial<Record<Stage, HTMLDivElement | null>>>({})
  const [scrolled, setScrolled] = useState(false)

  const [focused, setFocused] = useState<Stage>(startAt ?? "backlog")
  const offsetOf = (stage: Stage) => {
    const column = columnRefs.current[stage]
    const first = columnRefs.current.backlog
    return column && first ? column.offsetLeft - first.offsetLeft : 0
  }
  useLayoutEffect(() => {
    const element = scroller.current
    if (!element || !startAt) return
    element.scrollLeft = Math.max(0, offsetOf(startAt))
  }, [startAt, compact])
  const onScroll = (element: HTMLDivElement) => {
    setScrolled(element.scrollTop > 0)
    if (!compact) return
    const nearest = STAGES.reduce((best, stage) =>
      Math.abs(offsetOf(stage) - element.scrollLeft) < Math.abs(offsetOf(best) - element.scrollLeft) ? stage : best,
    )
    setFocused((previous) => (previous === nearest ? previous : nearest))
  }
  const jumpTo = (stage: Stage) => {
    setFocused(stage)
    scroller.current?.scrollTo({ left: offsetOf(stage), behavior: "smooth" })
  }

  const [stacks, setStack] = useStackState()

  const actions: CardActions = { interactive: true, onAct: act, onOpen }
  const dragging = useCardDrag({ board, columnRefs, live: true, onAct: act })
  const dropTarget = dragging.dropTarget

  return (
    <div className="flex h-full min-h-0 flex-col factory">
      <div className="flex min-h-0 grow flex-col overflow-clip">
        {compact ? <StageNav board={board} focused={focused} onSelect={jumpTo} /> : null}
        <div className="relative min-h-0 grow">
          <BoardMotion mode="live" ids={ids}>
            <motion.div
              ref={scroller}
              layoutScroll
              data-scrolled={scrolled ? "" : undefined}
              onScroll={(event) => onScroll(event.currentTarget)}
              className={cn(
                "group/scroll absolute inset-0 f-scroll",
                compact
                  ? "snap-x snap-mandatory scroll-pl-3 overflow-x-auto overflow-y-hidden overscroll-x-contain"
                  : "overflow-auto overscroll-contain",
              )}
            >
              <div className={cn("flex min-h-full w-max pt-[20px] pb-10", compact ? "gap-4 px-3" : "gap-[28px] px-6")}>
                {STAGES.map((stage) => (
                  <StageColumn
                    key={stage}
                    column={board[stage]}
                    actions={actions}
                    at={at}
                    now={now}
                    drag={dragging.drag}
                    dropActive={stage === "plan" && dropTarget?.kind === "promote"}
                    slot={
                      dropTarget?.kind === "reorder" && dropTarget.stage === stage
                        ? { ...dropTarget, height: dragging.slotHeight }
                        : undefined
                    }
                    columnRef={(element) => {
                      columnRefs.current[stage] = element
                    }}
                    expanded={stacks[stage] ?? false}
                    onToggleExpanded={(expanded) => setStack(stage, { expanded })}
                    compact={compact}
                  />
                ))}
              </div>
            </motion.div>
          </BoardMotion>
          <BoardEdges compact={compact} />
        </div>
      </div>
    </div>
  )
}

function BoardMotion({ mode, ids, children }: { mode: MotionMode; ids: BoardIds; children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <MotionModeContext.Provider value={mode}>
        <BoardIdsContext.Provider value={ids}>
          <LayoutGroup>{children}</LayoutGroup>
        </BoardIdsContext.Provider>
      </MotionModeContext.Provider>
    </MotionConfig>
  )
}

function BoardEdges({ compact }: { compact: boolean }) {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[56px] backdrop-blur-[3px]"
        style={{
          maskImage: "linear-gradient(to top, black 30%, transparent)",
          WebkitMaskImage: "linear-gradient(to top, black 30%, transparent)",
          backgroundImage: "linear-gradient(to top, var(--f-bg-primary) 0%, transparent 100%)",
        }}
      />
      <div
        aria-hidden
        className={cn("pointer-events-none absolute inset-y-0 left-0 z-20", compact ? "w-[12px]" : "w-[40px]")}
        style={{ backgroundImage: "linear-gradient(in oklab 90deg, var(--f-bg-primary) 20%, transparent 100%)" }}
      />
      <div
        aria-hidden
        className={cn("pointer-events-none absolute inset-y-0 right-0 z-20", compact ? "w-[24px]" : "w-[40px]")}
        style={{ backgroundImage: "linear-gradient(in oklab 270deg, var(--f-bg-primary) 15%, transparent 100%)" }}
      />
    </>
  )
}

function StageNav({
  board,
  focused,
  onSelect,
}: {
  board: BoardModel
  focused: Stage
  onSelect: (stage: Stage) => void
}) {
  const nav = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = nav.current
    const pill = element?.querySelector<HTMLElement>(`[data-nav-stage="${focused}"]`)
    if (!element || !pill) return
    const left = pill.offsetLeft
    const right = left + pill.offsetWidth
    if (left < element.scrollLeft + 8) element.scrollTo({ left: left - 8, behavior: "smooth" })
    else if (right > element.scrollLeft + element.clientWidth - 8)
      element.scrollTo({ left: right - element.clientWidth + 8, behavior: "smooth" })
  }, [focused])
  return (
    <div
      ref={nav}
      className="relative f-scroll flex shrink-0 gap-1 overflow-x-auto overscroll-x-contain px-2 pt-2 pb-1"
    >
      {STAGES.map((stage) => (
        <button
          key={stage}
          data-nav-stage={stage}
          type="button"
          aria-pressed={stage === focused}
          onClick={() => onSelect(stage)}
          className={cn(
            "flex h-7 shrink-0 f-press items-center gap-[6px] rounded-full px-[10px] t-xs",
            stage === focused ? "bg-(--f-fill-2) w-med text-(--f-text-1)" : "w-reg text-(--f-text-2)",
          )}
        >
          {STAGE_TITLES[stage]}
          <span className="tnum opacity-60">{board[stage].cards.length + board[stage].queue.length}</span>
        </button>
      ))}
    </div>
  )
}
