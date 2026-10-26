import { useEffect, useEffectEvent, useRef, useState } from "react"
import type { ReactNode, RefObject } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { useConnectionInteraction } from "../lib/connection-board-interaction.js"
import type { PendingLink } from "../lib/connection-board-interaction.js"
import { useConnectionSearch } from "../lib/connection-board-search.js"
import { Icon } from "./icon.js"
import { ProgressIndicator } from "./progress-indicator.js"
import { SearchField } from "./search-field.js"
import { Text } from "./text.js"

export type ConnectionBoardNode = { id: string; title: string }
export type ConnectionBoardTarget = { id: string; title: string }
export type ConnectionBoardLink = { sourceId: string; targetId: string }

export type ConnectionBoardProps = {
  viewport: { height: () => number; subscribe: (listener: () => void) => () => void }
  sources: ConnectionBoardNode[]
  targets: ConnectionBoardTarget[]
  links: ConnectionBoardLink[]
  onConnect: (sourceId: string, targetId: string) => void | Promise<void>
  onDisconnect: (sourceId: string) => void
  onConfigure?: ((sourceId: string) => void) | undefined
  sourceLabel: string
  sourceNodeIcon: ReactNode
  sourceNoun?: string
  targetLabel: string
  targetNoun: string
  targetSharing?: "exclusive" | "shared"
  busy?: boolean
}

const BOARD_WIDTH = 1000
const PROJECT_EDGE = 384
const CHANNEL_EDGE = 616
const NODE_H = 44
const ROW_H = 56
const MIN_BOARD_H = 440
const MAX_BOARD_BODY_H = 580
const BOARD_BOTTOM_MARGIN = 40
const LIST_PADDING = 12
const BOARD_INSET = 16
const SURFACE_WIDTH = PROJECT_EDGE + BOARD_INSET
const COLUMN_WIDTH = PROJECT_EDGE - BOARD_INSET

function percentOf(units: number) {
  return `${(units * 100) / BOARD_WIDTH}%`
}

const TARGET_COLUMN_STYLE = { left: percentOf(BOARD_INSET), width: percentOf(COLUMN_WIDTH) }
const SOURCE_COLUMN_STYLE = { left: percentOf(CHANNEL_EDGE), width: percentOf(COLUMN_WIDTH) }
const HEADER_STYLE = {
  gridTemplateColumns: `${SURFACE_WIDTH}fr ${BOARD_WIDTH - SURFACE_WIDTH * 2}fr ${SURFACE_WIDTH}fr`,
}
const HEADER_CELL_STYLE = { paddingInline: `${(BOARD_INSET * 100) / SURFACE_WIDTH}%` }
const NODE_ROW_STYLE = { height: NODE_H }

function useDropOnBoard(body: RefObject<HTMLElement | null>, armedTargetId: string | null, drop: () => void) {
  const onDrop = useEffectEvent(drop)
  const armed = armedTargetId !== null
  useEffect(() => {
    if (!armed) return
    const element = body.current
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !element?.contains(document.activeElement)) return
      event.stopPropagation()
      onDrop()
    }
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Node && element?.contains(event.target)) onDrop()
    }
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("click", onClick)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("click", onClick)
    }
  }, [armed, body])
}

function pluralize(noun: string) {
  return noun.endsWith("s") ? noun : `${noun}s`
}

function connectionPath(x1: number, y1: number, x2: number, y2: number) {
  const dx = (x2 - x1) * 0.55
  return `M ${x1} ${y1} C ${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`
}

function positionsFor(rows: { id: string }[], scrollTop = 0) {
  return new Map(rows.map((row, index) => [row.id, LIST_PADDING + index * ROW_H + NODE_H / 2 - scrollTop]))
}

function contentHeight(rows: { id: string }[], viewportH: number) {
  return Math.max(rows.length * ROW_H - (ROW_H - NODE_H) + LIST_PADDING * 2, viewportH)
}

function scrollFadesFor(rows: { id: string }[], scrollTop: number, viewportH: number) {
  return { top: scrollTop > 1, bottom: scrollTop + viewportH < contentHeight(rows, viewportH) - 1 }
}

function useBoardViewportHeight(ref: RefObject<HTMLElement | null>, viewport: ConnectionBoardProps["viewport"]) {
  const [height, setHeight] = useState(MIN_BOARD_H)
  useEffect(() => {
    const measure = () => {
      const top = ref.current?.getBoundingClientRect().top
      if (top === undefined) return
      const availableHeight = Math.floor(viewport.height() - top - BOARD_BOTTOM_MARGIN)
      setHeight(Math.min(MAX_BOARD_BODY_H, Math.max(MIN_BOARD_H, availableHeight)))
    }
    measure()
    return viewport.subscribe(measure)
  }, [ref, viewport])
  return height
}

type Focus = { kind: "source" | "target"; id: string } | null

export function ConnectionBoard(props: ConnectionBoardProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const sourceListRef = useRef<HTMLElement | null>(null)
  const targetListRef = useRef<HTMLElement | null>(null)
  const [focus, setFocus] = useState<Focus>(null)
  const sourceNoun = props.sourceNoun ?? "source"
  const allowSharedTargets = props.targetSharing === "shared"
  const search = useConnectionSearch(props.targets, props.sources, props.links, sourceListRef, targetListRef)
  const boardH = useBoardViewportHeight(bodyRef, props.viewport)
  const sourceY = positionsFor(search.visibleSources, search.sourceScrollTop)
  const targetY = positionsFor(search.visibleTargets, search.targetScrollTop)
  const linkBySource = new Map(props.links.map((link) => [link.sourceId, link.targetId]))
  const sourceByTarget = new Map(props.links.map((link) => [link.targetId, link.sourceId]))
  const interaction = useConnectionInteraction({
    targetY,
    linkBySource,
    sourceByTarget,
    allowSharedTargets,
    onConnect: props.onConnect,
    resetScroll: search.resetScroll,
    boardWidth: BOARD_WIDTH,
    projectEdge: PROJECT_EDGE,
  })
  const armedTargetId = interaction.armedTargetId
  useDropOnBoard(bodyRef, armedTargetId, interaction.drop)
  const pendingLink = interaction.pendingLink
  const pluralNoun = pluralize(sourceNoun)
  const pluralTargetNoun = pluralize(props.targetNoun)
  const locked = props.busy === true || pendingLink !== null

  return (
    <section data-slot="connection-board" aria-label="Integration routes" className="w-full">
      <div className="relative w-full pb-3">
        <BoardSurfaces />
        <BoardHeader
          query={search.sourceQuery}
          targetQuery={search.targetQuery}
          sourceLabel={props.sourceLabel}
          sourceNoun={pluralNoun}
          targetLabel={props.targetLabel}
          targetNoun={pluralTargetNoun}
          targetCount={props.targets.length}
          sourceCount={props.sources.length}
          onQueryChange={search.searchSources}
          onTargetQueryChange={search.searchTargets}
        />
        <p className="sr-only" aria-live="polite">
          {armedTargetId
            ? `Choose an available ${sourceNoun}.`
            : `Choose an available ${props.targetNoun} to create a route.`}
        </p>
        <div
          ref={bodyRef}
          className="relative w-full overflow-hidden"
          style={{ height: boardH }}
          aria-busy={locked}
          onMouseMove={interaction.trackPointer}
        >
          <ConnectionLines
            height={boardH}
            links={props.links}
            sourceY={sourceY}
            targetY={targetY}
            focus={focus}
            armedY={armedTargetId ? targetY.get(armedTargetId) : undefined}
            pointer={interaction.pointer}
            pending={pendingLink}
          />
          {pendingLink ? (
            <PendingSpinner
              top={((sourceY.get(pendingLink.sourceId) ?? 0) + (targetY.get(pendingLink.targetId) ?? 0)) / 2}
            />
          ) : null}
          <section
            ref={targetListRef}
            aria-label={pluralize(props.targetLabel)}
            className="absolute inset-y-0 scrollbar-gutter-stable overflow-x-hidden overflow-y-auto overscroll-contain"
            style={TARGET_COLUMN_STYLE}
            onScroll={(event) => search.syncScroll(event.currentTarget.scrollTop)}
          >
            <div className="relative" style={{ height: contentHeight(search.visibleTargets, boardH) }}>
              <TargetRows
                targets={props.targets}
                visibleTargets={search.visibleTargets}
                targetNoun={pluralTargetNoun}
                occupiedTargets={allowSharedTargets ? new Map<string, string>() : sourceByTarget}
                armedTargetId={armedTargetId}
                pendingLink={pendingLink}
                focus={focus}
                busy={locked}
                onArm={interaction.armTarget}
                onFocus={setFocus}
              />
            </div>
          </section>
          <section
            ref={sourceListRef}
            aria-label={props.sourceLabel}
            className="absolute inset-y-0 scrollbar-gutter-stable overflow-x-hidden overflow-y-auto overscroll-contain"
            style={SOURCE_COLUMN_STYLE}
            onScroll={(event) => search.syncScroll(event.currentTarget.scrollTop)}
          >
            <div className="relative" style={{ height: contentHeight(search.visibleSources, boardH) }}>
              <SourceRows
                sources={props.sources}
                visibleSources={search.visibleSources}
                sourceNoun={pluralNoun}
                sourceNodeIcon={props.sourceNodeIcon}
                linkBySource={linkBySource}
                armedTargetId={armedTargetId}
                pendingLink={pendingLink}
                focus={focus}
                busy={locked}
                onConnect={interaction.connectSource}
                onDisconnect={(sourceId) => {
                  search.resetScroll()
                  props.onDisconnect(sourceId)
                }}
                onConfigure={props.onConfigure}
                onFocus={setFocus}
              />
            </div>
          </section>
          <ScrollFades side="left" fades={scrollFadesFor(search.visibleTargets, search.targetScrollTop, boardH)} />
          <ScrollFades side="right" fades={scrollFadesFor(search.visibleSources, search.sourceScrollTop, boardH)} />
        </div>
      </div>
    </section>
  )
}

function BoardSurfaces() {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 rounded-container border border-border-primary bg-background-tertiary"
        style={{ width: percentOf(SURFACE_WIDTH) }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 rounded-container border border-border-primary bg-background-tertiary"
        style={{ width: percentOf(SURFACE_WIDTH) }}
      />
    </>
  )
}

function TargetRows(props: {
  targets: ConnectionBoardTarget[]
  visibleTargets: ConnectionBoardTarget[]
  targetNoun: string
  occupiedTargets: Map<string, string>
  armedTargetId: string | null
  pendingLink: PendingLink | null
  focus: Focus
  busy: boolean
  onArm: (targetId: string) => void
  onFocus: (focus: Focus) => void
}) {
  const positions = positionsFor(props.visibleTargets)
  return (
    <>
      {props.visibleTargets.length === 0 ? (
        <EmptyColumn>
          {props.targets.length === 0 ? `No ${props.targetNoun} yet.` : `No ${props.targetNoun} match your search.`}
        </EmptyColumn>
      ) : null}
      {props.visibleTargets.map((target) => (
        <TargetNode
          key={target.id}
          target={target}
          top={(positions.get(target.id) ?? NODE_H / 2) - NODE_H / 2}
          occupied={props.occupiedTargets.has(target.id)}
          armed={props.armedTargetId === target.id}
          pending={props.pendingLink?.targetId === target.id}
          dimmed={
            (props.pendingLink !== null && props.pendingLink.targetId !== target.id) ||
            (props.focus?.kind === "target" && props.focus.id !== target.id)
          }
          busy={props.busy}
          onArm={() => props.onArm(target.id)}
          onFocus={() => props.onFocus({ kind: "target", id: target.id })}
          onBlur={() => props.onFocus(null)}
        />
      ))}
    </>
  )
}

function SourceRows(props: {
  sources: ConnectionBoardNode[]
  visibleSources: ConnectionBoardNode[]
  sourceNoun: string
  sourceNodeIcon: ReactNode
  linkBySource: Map<string, string>
  armedTargetId: string | null
  pendingLink: PendingLink | null
  focus: Focus
  busy: boolean
  onConnect: (sourceId: string) => void | Promise<void>
  onDisconnect: (sourceId: string) => void
  onConfigure: ((sourceId: string) => void) | undefined
  onFocus: (focus: Focus) => void
}) {
  const positions = positionsFor(props.visibleSources)
  const onConfigure = props.onConfigure
  return (
    <>
      {props.visibleSources.length === 0 ? (
        <EmptyColumn>
          {props.sources.length === 0 ? `No ${props.sourceNoun} yet.` : `No ${props.sourceNoun} match your search.`}
        </EmptyColumn>
      ) : null}
      {props.visibleSources.map((source) => (
        <SourceNode
          key={source.id}
          source={source}
          icon={props.sourceNodeIcon}
          top={(positions.get(source.id) ?? NODE_H / 2) - NODE_H / 2}
          routed={props.linkBySource.has(source.id)}
          connectable={props.armedTargetId !== null && !props.linkBySource.has(source.id)}
          unavailable={props.armedTargetId !== null && props.linkBySource.has(source.id)}
          pending={props.pendingLink?.sourceId === source.id}
          dimmed={
            (props.pendingLink !== null && props.pendingLink.sourceId !== source.id) ||
            (props.focus?.kind === "source" && props.focus.id !== source.id)
          }
          busy={props.busy}
          onConnect={() => void props.onConnect(source.id)}
          onDisconnect={() => props.onDisconnect(source.id)}
          onConfigure={onConfigure ? () => onConfigure(source.id) : undefined}
          onFocus={() => props.onFocus({ kind: "source", id: source.id })}
          onBlur={() => props.onFocus(null)}
        />
      ))}
    </>
  )
}

function ScrollFades(props: { side: "left" | "right"; fades: { top: boolean; bottom: boolean } }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 z-10 overflow-hidden rounded-container"
      style={props.side === "left" ? TARGET_COLUMN_STYLE : SOURCE_COLUMN_STYLE}
    >
      <div
        className={composeClasses(
          "absolute inset-x-0 top-0 h-8 bg-linear-to-b from-background-tertiary to-transparent transition-standard motion-reduce:transition-none",
          props.fades.top ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        className={composeClasses(
          "absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-background-tertiary to-transparent transition-standard motion-reduce:transition-none",
          props.fades.bottom ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  )
}

function BoardHeader(props: {
  query: string
  targetQuery: string
  sourceLabel: string
  sourceNoun: string
  targetLabel: string
  targetNoun: string
  targetCount: number
  sourceCount: number
  onQueryChange: (query: string) => void
  onTargetQueryChange: (query: string) => void
}) {
  return (
    <div className="relative grid h-12 items-center" style={HEADER_STYLE}>
      <HeaderCell
        title={`1. Select a ${props.targetLabel}`}
        count={props.targetCount}
        query={props.targetQuery}
        onQueryChange={props.onTargetQueryChange}
        placeholder={`Search ${props.targetNoun}`}
        label={`Search ${pluralize(props.targetLabel)}`}
      />
      <div />
      <HeaderCell
        title={`2. Select ${props.sourceNoun}`}
        count={props.sourceCount}
        query={props.query}
        onQueryChange={props.onQueryChange}
        placeholder={`Search ${props.sourceNoun}`}
        label={`Search ${props.sourceLabel}`}
      />
    </div>
  )
}

function HeaderCell(props: {
  title: string
  count: number
  query: string
  onQueryChange: (query: string) => void
  placeholder: string
  label: string
}) {
  return (
    <div className="group/column flex min-w-0 items-center gap-2" style={HEADER_CELL_STYLE}>
      <div className="min-w-0 flex-1 group-has-[input]/column:hidden">
        <Text purpose="label" truncation="single-line">
          {props.title}{" "}
          <Text purpose="body" tone="secondary" weight="regular" element="span">
            ({props.count})
          </Text>
        </Text>
      </div>
      <SearchField.Expandable
        value={props.query}
        onValueChange={props.onQueryChange}
        placeholder={props.placeholder}
        label={props.label}
        size="medium"
        width="fill"
      />
    </div>
  )
}

function PendingSpinner(props: { top: number }) {
  return (
    <span
      className="pointer-events-none absolute left-1/2 flex size-6 -translate-1/2 items-center justify-center rounded-full border border-border-secondary bg-background-secondary"
      style={{ top: props.top }}
    >
      <ProgressIndicator size="small" label="Connecting" />
    </span>
  )
}

function EmptyColumn(props: { children: ReactNode }) {
  return (
    <div className="absolute inset-x-0 top-2 flex h-11 items-center justify-center rounded-container border border-dashed border-border-primary px-3 text-center text-xs text-text-secondary">
      {props.children}
    </div>
  )
}

function ConnectionLines(props: {
  height: number
  links: ConnectionBoardLink[]
  sourceY: Map<string, number>
  targetY: Map<string, number>
  focus: Focus
  armedY: number | undefined
  pointer: { x: number; y: number } | null
  pending: PendingLink | null
}) {
  const focus = props.focus
  const pending = props.pending
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full mask-y-from-transparent mask-y-to-text-primary mask-y-to-12"
      viewBox={`0 0 ${BOARD_WIDTH} ${props.height}`}
      preserveAspectRatio="none"
      role="presentation"
    >
      {props.links.map((link) => {
        const sourcePosition = props.sourceY.get(link.sourceId)
        const targetPosition = props.targetY.get(link.targetId)
        if (sourcePosition === undefined || targetPosition === undefined) return null
        const related = !focus || (focus.kind === "source" ? focus.id === link.sourceId : focus.id === link.targetId)
        return (
          <g
            key={`${link.sourceId}->${link.targetId}`}
            className={composeClasses("transition-standard", related ? "opacity-100" : "opacity-tint")}
          >
            <path
              d={connectionPath(PROJECT_EDGE, targetPosition, CHANNEL_EDGE, sourcePosition)}
              className="connection-flow"
            />
          </g>
        )
      })}
      {props.armedY !== undefined && props.pointer ? (
        <path
          d={connectionPath(PROJECT_EDGE, props.armedY, props.pointer.x, props.pointer.y)}
          className="connection-draft text-accent-primary"
        />
      ) : null}
      {pending ? (
        <g>
          <path
            d={connectionPath(
              PROJECT_EDGE,
              props.targetY.get(pending.targetId) ?? 0,
              CHANNEL_EDGE,
              props.sourceY.get(pending.sourceId) ?? 0,
            )}
            className="connection-flow"
          />
        </g>
      ) : null}
    </svg>
  )
}

function SourceNode(props: {
  source: ConnectionBoardNode
  icon: ReactNode
  top: number
  routed: boolean
  connectable: boolean
  unavailable: boolean
  pending: boolean
  dimmed: boolean
  busy: boolean
  onConnect: () => void
  onDisconnect: () => void
  onConfigure: (() => void) | undefined
  onFocus: () => void
  onBlur: () => void
}) {
  return (
    <div
      className="absolute inset-x-0"
      style={{ ...NODE_ROW_STYLE, top: props.top }}
      onMouseEnter={props.onFocus}
      onMouseLeave={props.onBlur}
      onFocus={props.onFocus}
      onBlur={props.onBlur}
    >
      <button
        type="button"
        disabled={props.busy || !props.connectable}
        aria-label={props.connectable ? `Route to ${props.source.title}` : undefined}
        onClick={(event) => {
          event.stopPropagation()
          props.onConnect()
        }}
        className={composeClasses(
          "flex size-full items-center gap-3 overflow-hidden rounded-container border px-3 text-left transition-standard outline-none focus-visible:border-border-secondary focus-visible:ring-3 focus-visible:ring-accent-primary/disabled",
          props.connectable
            ? "cursor-pointer border-accent-primary bg-accent-primary/tint hover:bg-accent-primary/tint"
            : "border-border-secondary bg-background-secondary",
          props.pending && "border-accent-primary bg-accent-primary/tint",
          (props.unavailable || props.dimmed) && "opacity-disabled",
        )}
      >
        <span className="shrink-0">
          <Text purpose="body" tone="secondary" element="span">
            {props.icon}
          </Text>
        </span>
        <span
          className={composeClasses(
            "min-w-0 truncate text-sm font-medium text-text-primary",
            props.routed && props.onConfigure ? "pr-12" : "pr-6",
          )}
        >
          {props.source.title}
        </span>
      </button>
      <span className="pointer-events-none absolute top-1/2 left-0 flex size-3 -translate-1/2 items-center justify-center rounded-full bg-background-secondary">
        <span className="size-2 rounded-full border-4 border-border-secondary" />
      </span>
      {props.routed ? (
        <SourceActions
          title={props.source.title}
          busy={props.busy}
          onDisconnect={props.onDisconnect}
          onConfigure={props.onConfigure}
        />
      ) : null}
    </div>
  )
}

function SourceActions(props: {
  title: string
  busy: boolean
  onDisconnect: () => void
  onConfigure: (() => void) | undefined
}) {
  const onConfigure = props.onConfigure
  return (
    <>
      {onConfigure ? (
        <button
          type="button"
          disabled={props.busy}
          aria-label={`Configure ${props.title}`}
          title="Configure"
          onClick={(event) => {
            event.stopPropagation()
            onConfigure()
          }}
          className="absolute top-1/2 right-10 flex size-6 -translate-y-1/2 items-center justify-center rounded-control text-text-secondary transition-standard outline-none hover:bg-fill-primary hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent-primary/disabled disabled:cursor-not-allowed disabled:opacity-disabled"
        >
          <Icon glyph="Settings2" />
        </button>
      ) : null}
      <button
        type="button"
        disabled={props.busy}
        aria-label={`Unroute ${props.title}`}
        title="Unroute"
        onClick={(event) => {
          event.stopPropagation()
          props.onDisconnect()
        }}
        className="absolute top-1/2 right-3 flex size-6 -translate-y-1/2 items-center justify-center rounded-control border border-status-danger/disabled bg-status-danger/tint text-status-danger transition-standard outline-none hover:bg-status-danger/tint focus-visible:ring-2 focus-visible:ring-status-danger/disabled disabled:cursor-not-allowed disabled:opacity-disabled"
      >
        <Icon glyph="X" />
      </button>
    </>
  )
}

function TargetNode(props: {
  target: ConnectionBoardTarget
  top: number
  occupied: boolean
  armed: boolean
  pending: boolean
  dimmed: boolean
  busy: boolean
  onArm: () => void
  onFocus: () => void
  onBlur: () => void
}) {
  return (
    <div
      className="absolute inset-x-0"
      style={{ ...NODE_ROW_STYLE, top: props.top }}
      onMouseEnter={props.onFocus}
      onMouseLeave={props.onBlur}
      onFocus={props.onFocus}
      onBlur={props.onBlur}
    >
      <span className="pointer-events-none absolute top-1/2 right-0 flex size-3 translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-background-secondary">
        <span className="size-2 rounded-full border-4 border-border-secondary" />
      </span>
      <button
        type="button"
        disabled={props.busy || props.occupied}
        aria-pressed={props.armed}
        onClick={(event) => {
          event.stopPropagation()
          props.onArm()
        }}
        className={composeClasses(
          "flex size-full items-center gap-3 overflow-hidden rounded-container border border-border-secondary bg-background-secondary px-3 text-left transition-standard outline-none focus-visible:ring-3 focus-visible:ring-accent-primary/disabled",
          props.armed ? "border-accent-primary bg-accent-primary/tint" : !props.occupied && "hover:bg-fill-primary",
          props.pending && "border-accent-primary bg-accent-primary/tint",
          props.dimmed && "opacity-disabled",
        )}
      >
        <Icon glyph="Folder" tone="secondary" />
        <span className="block min-w-0">
          <Text purpose="label" truncation="single-line">
            {props.target.title}
          </Text>
        </span>
      </button>
    </div>
  )
}
