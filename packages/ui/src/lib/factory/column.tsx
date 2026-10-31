import { AnimatePresence, motion, useReducedMotion, type PanInfo, type Transition } from "motion/react"
import { use, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react"
import { cn } from "cn"
import type { CardModel, ColumnModel } from "./board.js"
import { formatAge, formatDayLabel, formatTokens, formatUsd } from "./format.js"
import { startOfDay } from "./time.js"
import { STAGE_TITLES } from "./types.js"
import { FactoryCard, type CardActions } from "./card.js"
import { BoardIdsContext, COLUMN_WIDTH, ColumnWidthContext, MotionModeContext, type MotionMode } from "./context.js"
import { ChevronDown, Hand, HeaderCircle } from "./icons.js"
import { Lattice } from "./lattice.js"

const EASE_OUT = [0.23, 1, 0.32, 1] as const
const TRAVEL: Record<MotionMode, Transition> = {
  live: { type: "spring", duration: 0.55, bounce: 0.15 },
  replay: { type: "spring", duration: 0.75, bounce: 0 },
}
const COMPACT_COLUMN_WIDTH = 296
const COMPACT_CARDS = 3
const BLUR = "blur(2px)"
const SHARP = "blur(0px)"

export type CardList = "cards" | "queue"
export type ReorderSlot = { list: CardList; before?: string; height: number }

export type DragHandlers = {
  enabled: boolean
  onDragStart: (taskId: string) => void
  onDrag: (taskId: string, point: { x: number; y: number }) => void
  onDrop: (taskId: string, point: { x: number; y: number }) => void
}

function DropSlot({ height }: { height: number }) {
  return (
    <motion.div
      key="drop-slot"
      layout="position"
      aria-hidden
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
      transition={{ opacity: { duration: 0.15, ease: EASE_OUT } }}
      style={{ height }}
      className="shrink-0 rounded-[10px] bg-(--f-fill-1) shadow-[var(--f-border-1)_0px_0px_0px_1px_inset]"
    />
  )
}

function withSlot(
  cards: CardModel[],
  slot: ReorderSlot | undefined,
  list: CardList,
  render: (card: CardModel, index: number) => ReactNode,
) {
  const nodes = cards.flatMap((card, index) =>
    slot?.list === list && slot.before === card.id
      ? [<DropSlot key="drop-slot" height={slot.height} />, render(card, index)]
      : [render(card, index)],
  )
  if (slot?.list === list && !slot.before) nodes.push(<DropSlot key="drop-slot" height={slot.height} />)
  return nodes
}

type StackEntry = { index: number; offset: number }

const lastStage = new Map<string, string>()

function stackedPose(stack: StackEntry) {
  return {
    opacity: 0,
    y: -stack.offset + 6 * Math.min(stack.index, 2),
    scale: 1 - 0.05 * Math.min(stack.index, 2),
    filter: BLUR,
  }
}

function cardTransition(mode: MotionMode, stack: StackEntry | undefined, state: { travelling: boolean }): Transition {
  const delay = stack ? (stack.index - 1) * 0.04 : 0
  const settle = stack
    ? { type: "spring" as const, duration: 0.45, bounce: 0.1, delay }
    : { duration: 0.2, ease: EASE_OUT }
  return {
    layout: TRAVEL[mode],
    opacity: { duration: 0.25, ease: EASE_OUT, delay },
    y: { ...settle },
    scale: { ...settle },
    filter: { duration: state.travelling ? 0.12 : 0.3, ease: EASE_OUT, delay },
  }
}

function useTravelBlur(card: CardModel, mode: MotionMode) {
  const [travelling, setTravelling] = useState(false)
  const blurTimer = useRef<number | undefined>(undefined)
  const crossed = useRef(lastStage.has(card.id) && lastStage.get(card.id) !== card.stage)
  useEffect(() => {
    lastStage.set(card.id, card.stage)
  }, [card.id, card.stage])
  return {
    travelling,
    onLayoutAnimationStart: () => {
      if (!crossed.current) return
      crossed.current = false
      setTravelling(true)
      window.clearTimeout(blurTimer.current)
      blurTimer.current = window.setTimeout(() => setTravelling(false), mode === "replay" ? 380 : 260)
    },
    onLayoutAnimationComplete: () => {
      window.clearTimeout(blurTimer.current)
      setTravelling(false)
    },
  }
}

function useCardDragging(card: CardModel, list: CardList, drag: DragHandlers | undefined) {
  const dragged = useRef(false)
  const dragger =
    drag?.enabled && (card.stage === "backlog" || (list === "queue" && !card.scheduled)) ? drag : undefined
  const onClickCapture = (event: React.MouseEvent) => {
    if (!dragged.current) return
    event.stopPropagation()
    event.preventDefault()
  }
  if (!dragger) return { drag: false, onClickCapture }
  return {
    drag: true,
    onDragStart: () => {
      dragged.current = true
      dragger.onDragStart(card.id)
    },
    onDrag: (_event: PointerEvent, info: PanInfo) => dragger.onDrag(card.id, info.point),
    onDragEnd: (_event: PointerEvent, info: PanInfo) => {
      dragger.onDrop(card.id, info.point)
      window.setTimeout(() => {
        dragged.current = false
      }, 0)
    },
    onClickCapture,
  }
}

function CardShell({
  card,
  actions,
  layoutKey,
  drag,
  stack,
  list,
}: {
  card: CardModel
  actions: CardActions
  layoutKey: string
  list: CardList
  drag?: DragHandlers | undefined
  stack?: StackEntry | undefined
}) {
  const mode = use(MotionModeContext)
  const ids = use(BoardIdsContext)
  const reduce = useReducedMotion()
  const travel = useTravelBlur(card, mode)
  const dragging = useCardDragging(card, list, drag)
  const stacked = stack ? stackedPose(stack) : undefined
  const fade = reduce ? SHARP : BLUR
  const entering = ids.previous.has(card.id) ? false : { opacity: 0, filter: fade }

  return (
    <motion.div
      layoutId={card.id}
      layout="position"
      layoutDependency={layoutKey}
      initial={stacked ?? entering}
      animate={{ opacity: 1, y: 0, scale: 1, filter: travel.travelling && !reduce ? BLUR : SHARP }}
      variants={{
        exit: (current?: Set<string>) => {
          if (current?.has(card.id)) return { opacity: 0, transition: { duration: 0 } }
          if (stacked) return { ...stacked, transition: { duration: 0.2, ease: EASE_OUT } }
          return { opacity: 0, scale: 0.97, filter: fade, transition: { duration: 0.2, ease: EASE_OUT } }
        },
      }}
      exit="exit"
      custom={ids.current}
      transition={cardTransition(mode, stack, { travelling: travel.travelling })}
      onLayoutAnimationStart={travel.onLayoutAnimationStart}
      onLayoutAnimationComplete={travel.onLayoutAnimationComplete}
      dragSnapToOrigin
      dragElastic={0.18}
      dragMomentum={false}
      whileDrag={{ scale: 1.02, zIndex: 40, cursor: "grabbing", boxShadow: "0px 12px 32px rgb(0 0 0 / 50%)" }}
      {...dragging}
      data-card-id={card.id}
      data-reorder-list={`${card.stage}:${list}`}
      data-stack-top={list === "queue" && !stack ? "" : undefined}
      style={stack ? { zIndex: -stack.index } : {}}
      className={cn("relative rounded-[10px]", dragging.drag && "cursor-grab touch-none")}
    >
      <FactoryCard card={card} actions={actions} />
    </motion.div>
  )
}

function layoutKeyOf(cards: CardModel[], slot: ReorderSlot | undefined) {
  return (
    cards.map((card) => `${card.id}:${card.phase}:${card.gate ?? ""}`).join("|") +
    (slot ? `#${slot.list}:${slot.before ?? "end"}` : "")
  )
}

export function StageColumn({
  column,
  actions,
  at,
  now,
  drag,
  dropActive,
  slot,
  columnRef,
  expanded,
  onToggleExpanded,
  compact = false,
}: {
  compact?: boolean
  column: ColumnModel
  actions: CardActions
  at: number
  now: number
  drag: DragHandlers
  dropActive: boolean
  slot?: ReorderSlot | undefined
  columnRef: Ref<HTMLDivElement>
  expanded: boolean
  onToggleExpanded: (expanded: boolean) => void
}) {
  const ids = use(BoardIdsContext)
  const cards = compact ? column.cards.slice(0, COMPACT_CARDS) : column.cards
  const hidden = compact ? column.cards.length - cards.length + column.queue.length : 0
  const width = compact ? COMPACT_COLUMN_WIDTH : COLUMN_WIDTH
  const layoutKey = layoutKeyOf([...cards, ...(compact ? [] : column.queue)], slot)
  return (
    <div
      ref={columnRef}
      data-stage={column.stage}
      style={{ width }}
      className={cn("relative flex shrink-0 flex-col gap-3", compact && "snap-start")}
    >
      <ColumnWidthContext.Provider value={width}>
        <ColumnHeader column={column} at={at} now={now} />
        <div className="flex flex-col gap-3">
          <AnimatePresence initial={false} custom={ids.current}>
            {withSlot(cards, slot, "cards", (card) => (
              <CardShell key={card.id} card={card} list="cards" actions={actions} layoutKey={layoutKey} drag={drag} />
            ))}
          </AnimatePresence>
          {hidden > 0 ? (
            <div className="flex items-center gap-2 px-1 pt-1">
              <div className="w-max tnum t-xs w-med text-(--f-text-2)">+{hidden} more</div>
              <div className="h-px grow bg-(--f-border-1)" />
            </div>
          ) : null}
          {!compact && column.queue.length > 0 ? (
            <UpNext
              cards={column.queue}
              actions={actions}
              layoutKey={layoutKey}
              drag={drag}
              slot={slot}
              expanded={expanded}
              onToggleExpanded={onToggleExpanded}
            />
          ) : null}
          <AnimatePresence>
            {dropActive ? (
              <motion.div
                key="drop-slot"
                aria-hidden
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                transition={{ duration: 0.15, ease: EASE_OUT }}
                className="h-[84px] rounded-[10px] bg-(--f-fill-1) shadow-[var(--f-border-1)_0px_0px_0px_1px_inset]"
              />
            ) : null}
          </AnimatePresence>
        </div>
      </ColumnWidthContext.Provider>
    </div>
  )
}

function ColumnHeader({ column, at, now }: { column: ColumnModel; at: number; now: number }) {
  const count = column.cards.length + column.queue.length
  const backlog = column.stage === "backlog"
  const pending = backlog ? column.cards.length : column.queued
  return (
    <div className="sticky top-0 z-10 mx-[-14px] mt-[-20px] mb-1 flex flex-col gap-2 bg-(--f-bg-primary) px-[18px] pt-[20px] pb-[14px] shadow-[var(--f-border-1)_0px_-1px_0px_inset] group-data-scrolled/scroll:shadow-none">
      <div className="flex h-[28px] shrink-0 items-center gap-2">
        <div className="w-max t-base w-semi tracking-snug text-(--f-ink)">{STAGE_TITLES[column.stage]}</div>
        <div className="w-max tnum t-base w-med text-(--f-text-2)">{count}</div>
        <div className="grow" />
        <div className="flex items-center gap-3">
          {column.working > 0 ? (
            <HeaderCount icon={<Lattice size={12} label={`${column.working} working`} />}>{column.working}</HeaderCount>
          ) : null}
          {pending > 0 ? <HeaderCount icon={<HeaderCircle />}>{pending}</HeaderCount> : null}
          {column.waiting > 0 ? (
            <HeaderCount icon={<Hand size={12} />} tone="amber">
              {column.waiting}
            </HeaderCount>
          ) : null}
        </div>
      </div>
      <div className="flex items-baseline gap-4">
        {backlog ? (
          <>
            <Stat value={String(column.cards.length)} unit="untriaged" />
            <Stat value={column.cards.length ? formatAge(column.oldestMs) : "—"} unit="oldest" />
          </>
        ) : (
          <>
            <Stat value={formatUsd(column.spentToday)} unit="spent" />
            <Stat value={formatTokens(column.tokensToday)} unit="tokens" />
            <div className="grow" />
            <div className="w-max t-xs w-reg text-(--f-text-2)">
              {startOfDay(at) === startOfDay(now) ? "Today" : formatDayLabel(at)}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function HeaderCount({ icon, children, tone }: { icon: ReactNode; children: ReactNode; tone?: "amber" }) {
  return (
    <div className="flex items-center gap-1">
      {icon}
      <div className={cn("w-max tnum t-xs w-reg", tone === "amber" ? "text-(--f-amber)" : "text-(--f-text-2)")}>
        {children}
      </div>
    </div>
  )
}

function Stat({ value, unit }: { value: string; unit: string }) {
  return (
    <div className="flex items-baseline gap-[5px]">
      <div className="w-max tnum t-sm w-med text-(--f-ink)">{value}</div>
      <div className="w-max t-xs w-reg text-(--f-text-2)">{unit}</div>
    </div>
  )
}

function UpNext({
  cards,
  actions,
  layoutKey,
  drag,
  slot,
  expanded,
  onToggleExpanded,
}: {
  cards: CardModel[]
  actions: CardActions
  layoutKey: string
  drag: DragHandlers
  slot: ReorderSlot | undefined
  expanded: boolean
  onToggleExpanded: (expanded: boolean) => void
}) {
  const ids = use(BoardIdsContext)
  const [peeking, setPeeking] = useState(false)
  const [suppressed, setSuppressed] = useState(false)
  const hoverTimer = useRef<number | undefined>(undefined)
  const list = useRef<HTMLDivElement>(null)
  const [topHeight, setTopHeight] = useState(78)
  const stackable = cards.length > 1
  const open = stackable && (expanded || (peeking && !suppressed))
  const stacked = stackable && !open
  const visible = open ? cards : cards.slice(0, 1)
  const firstId = cards.at(0)?.id

  useLayoutEffect(() => {
    const element = list.current?.querySelector<HTMLElement>("[data-stack-top]")
    if (!element) return
    const observer = new ResizeObserver(() => setTopHeight(element.offsetHeight))
    observer.observe(element)
    setTopHeight(element.offsetHeight)
    return () => observer.disconnect()
  }, [firstId])

  return (
    <div
      className="flex flex-col gap-3"
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse") return
        window.clearTimeout(hoverTimer.current)
        hoverTimer.current = window.setTimeout(() => setPeeking(true), 80)
      }}
      onPointerLeave={() => {
        window.clearTimeout(hoverTimer.current)
        setPeeking(false)
        setSuppressed(false)
      }}
    >
      <UpNextHeader
        count={cards.length}
        expanded={expanded}
        stackable={stackable}
        open={open}
        onToggle={() => {
          const next = !expanded
          onToggleExpanded(next)
          setSuppressed(!next)
        }}
      />
      <div ref={list} className={cn("relative isolate flex flex-col", stacked && "pb-3", open && "gap-3")}>
        <StackShadows stacked={stacked} />
        <AnimatePresence initial={false} custom={ids.current} mode="popLayout">
          {withSlot(open ? visible : [], open ? slot : undefined, "queue", (card, index) => (
            <CardShell
              key={card.id}
              card={card}
              list="queue"
              actions={actions}
              drag={open ? drag : undefined}
              layoutKey={`${layoutKey}:${open}`}
              stack={index > 0 ? { index, offset: index * (topHeight + 12) } : undefined}
            />
          ))}
          {open
            ? null
            : visible.map((card) => (
                <CardShell
                  key={card.id}
                  card={card}
                  list="queue"
                  actions={actions}
                  layoutKey={`${layoutKey}:${open}`}
                />
              ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

function UpNextHeader({
  count,
  expanded,
  stackable,
  open,
  onToggle,
}: {
  count: number
  expanded: boolean
  stackable: boolean
  open: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex items-center gap-2 px-1 pt-3">
      <div className="w-max t-xs w-med text-(--f-text-2)">Up next</div>
      <div className="w-max t-xs w-reg text-(--f-text-2) opacity-60">{count}</div>
      <div className="h-px grow bg-(--f-border-1)" />
      <button
        type="button"
        aria-label={expanded ? "Stack up next" : "Expand up next"}
        aria-pressed={expanded}
        disabled={!stackable}
        onClick={onToggle}
        className="-m-1 flex size-5 f-press items-center justify-center rounded-sm disabled:opacity-60"
      >
        <span
          className="flex transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
          style={{ transform: open ? "rotate(180deg)" : "none" }}
        >
          <ChevronDown />
        </span>
      </button>
    </div>
  )
}

function StackShadows({ stacked }: { stacked: boolean }) {
  return (
    <>
      <div
        aria-hidden
        className={cn(
          "absolute inset-x-4 bottom-0 -z-20 h-[28px] rounded-[10px] bg-[#1a1a1a] shadow-[#ffffff17_0px_0px_0px_1px] transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
          stacked ? "translate-y-0 opacity-100 delay-100" : "-translate-y-2 opacity-0",
        )}
      />
      <div
        aria-hidden
        className={cn(
          "absolute inset-x-2 bottom-[6px] -z-10 h-[28px] rounded-[10px] bg-[#1d1d1d] shadow-[#ffffff1c_0px_0px_0px_1px] transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
          stacked ? "translate-y-0 opacity-100 delay-75" : "-translate-y-1 opacity-0",
        )}
      />
    </>
  )
}
