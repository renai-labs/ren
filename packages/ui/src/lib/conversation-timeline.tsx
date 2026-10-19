import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual"
import type { VirtualItem } from "@tanstack/react-virtual"
import { use, useEffect, useEffectEvent, useImperativeHandle, useLayoutEffect, useRef, useState } from "react"
import type { ReactNode, Ref } from "react"
import { Icon } from "../components/icon.js"
import { LoadingMessage } from "../components/loading-message.js"
import { composeClasses } from "./compose-classes.js"
import { ShellContext } from "./conversation-context.js"

export function JumpToLatest(props: { visible: boolean; onActivate: () => void; composerHeight?: number | undefined }) {
  return (
    <button
      type="button"
      aria-label="Scroll to bottom"
      onClick={props.onActivate}
      style={props.composerHeight ? { bottom: props.composerHeight - 20 } : undefined}
      className={composeClasses(
        "absolute bottom-4 left-1/2 z-20 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-border-primary/disabled bg-background-secondary text-text-secondary shadow-overlay transition-standard hover:text-text-primary active:scale-95 [&_svg]:size-4",
        props.visible ? "pointer-events-auto scale-100 opacity-100" : "pointer-events-none scale-90 opacity-0",
      )}
    >
      <Icon glyph="ArrowDown" />
    </button>
  )
}

export type TimelineHandle = {
  resume: () => void
  step: (offset: number) => void
}

export type TimelineHistory = {
  more: boolean
  loading: boolean
  onLoadOlder: () => void
}

export type TimelineProps<Item> = {
  label: string
  items: ReadonlyArray<Item>
  itemKey: (item: Item) => string
  // ast-grep-ignore: no-render-props, -- hands each virtualized row back to the caller
  renderItem: (item: Item) => ReactNode
  marker?: (item: Item) => boolean
  itemMessage?: (item: Item) => string | undefined
  itemBusy?: (item: Item) => boolean
  footer?: ReactNode
  history?: TimelineHistory | undefined
  target?: string | undefined
  hold?: boolean
  onFollowChange?: (following: boolean) => void
  ref?: Ref<TimelineHandle>
}

const estimate = 60
const endEpsilon = 0.5
const historyEdge = 200
const markerLine = 100
const footerKey = "timeline:footer"
const scrollKeys: Readonly<Record<string, "up" | "down">> = {
  ArrowUp: "up",
  PageUp: "up",
  Home: "up",
  ArrowDown: "down",
  PageDown: "down",
  End: "down",
  " ": "down",
}

const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.closest("input, textarea, select, [role='textbox']") !== null)

const nestedScroller = (target: EventTarget | null, root: Element) => {
  const nested = target instanceof Element ? target.closest("[data-scrollable]") : null
  return nested !== null && nested !== root && root.contains(nested) && nested.scrollHeight > nested.clientHeight
}

const scrollIntent = (event: KeyboardEvent, root: Element) => {
  const direction = scrollKeys[event.key]
  if (!direction || event.altKey || event.ctrlKey || event.metaKey || editable(event.target)) return null
  const space = event.key === " "
  if (space && event.target instanceof Element && event.target.closest("button, a, summary, [role]")) return null
  if (nestedScroller(event.target, root)) return null
  return space && event.shiftKey ? "up" : direction
}

const distanceFromEnd = (root: Element) => root.scrollHeight - root.clientHeight - root.scrollTop

interface Gesture {
  scrollTop: number
  maxScroll: number
  pointer: boolean
  touch: number | undefined
  touchTarget: EventTarget | null
  touchNested: boolean
  touching: boolean
  mark: number
  active: { key: string; mark: number } | undefined
  frame: number | undefined
  revealed: string | undefined
  anchor: string | undefined
  requesting: boolean
  dock: number
  stick: boolean
  known: Set<string>
  added: Set<string>
}

const gesture = (): Gesture => ({
  scrollTop: 0,
  maxScroll: 0,
  pointer: false,
  touch: undefined,
  touchTarget: null,
  touchNested: false,
  touching: false,
  mark: 0,
  active: undefined,
  frame: undefined,
  revealed: undefined,
  anchor: undefined,
  requesting: false,
  dock: 0,
  stick: false,
  known: new Set(),
  added: new Set(),
})

const currentMarker = (
  state: Gesture,
  markers: ReadonlyArray<number>,
  keys: ReadonlyArray<string>,
  starts: ReadonlyArray<VirtualItem>,
  line: number,
) => {
  const active = state.active
  if (active && active.mark === state.mark) return markers.findIndex((index) => keys[index] === active.key)
  return markers.findLastIndex((index) => (starts[index]?.start ?? 0) <= line)
}

export function Timeline<Item>(props: TimelineProps<Item>) {
  const shell = use(ShellContext)
  const scroller = useRef<HTMLElement>(null)
  const sizer = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const state = useRef(gesture()).current
  const latest = useRef<ReadonlyArray<string>>([])
  const [pinned, setPinned] = useState(true)
  const [jump, setJump] = useState(false)
  const [margin, setMargin] = useState(48)
  const [dockHeight, setDockHeight] = useState(0)
  const [settled, setSettled] = useState(false)
  const keys = props.items.map(props.itemKey)
  const count = keys.length + (props.footer ? 1 : 0)
  const targetIndex = props.target === undefined ? -1 : keys.indexOf(props.target)
  const history = props.history
  // oxlint-disable-next-line react/incompatible-library -- the React Compiler skips this component, so the mutable virtualizer instance is read fresh on every render
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scroller.current,
    estimateSize: () => estimate,
    getItemKey: (index) => keys[index] ?? (index === keys.length ? footerKey : `removed:${index}`),
    overscan: 2,
    scrollMargin: margin,
    scrollPaddingStart: margin,
    paddingEnd: 24 + Math.max(24, dockHeight + 8),
    anchorTo: "end",
    followOnAppend: pinned,
    scrollEndThreshold: pinned ? 80 : endEpsilon,
    rangeExtractor: (range) =>
      [...new Set([...defaultRangeExtractor(range), targetIndex])]
        .filter((index) => index >= 0 && index < range.count)
        .toSorted((a, b) => a - b),
    measureElement: (element, entry, instance) => {
      if (!element.isConnected)
        return instance.itemSizeCache.get(instance.options.getItemKey(instance.indexFromElement(element))) ?? estimate
      const box = entry?.borderBoxSize.at(0)
      if (box) return Math.round(box.blockSize)
      return element instanceof HTMLElement ? element.offsetHeight : estimate
    },
  })

  const follow = (next: boolean) => {
    if (following.current === next) return
    following.current = next
    if (next) {
      state.active = undefined
      state.anchor = undefined
    }
    setPinned(next)
    props.onFollowChange?.(next)
  }
  const unpin = () => {
    const root = scroller.current
    if (!root || root.scrollHeight - root.clientHeight <= 1) return
    follow(false)
  }
  const schedule = () => {
    if (state.frame !== undefined) return
    state.frame = requestAnimationFrame(() => {
      state.frame = undefined
      const root = scroller.current
      if (!root) return
      const max = root.scrollHeight - root.clientHeight
      setJump(max > 1 && max - root.scrollTop > Math.max(400, root.clientHeight))
    })
  }
  const resume = () => {
    follow(true)
    virtualizer.scrollToEnd()
    schedule()
  }
  const markUserScroll = (target: EventTarget | null) => {
    const root = scroller.current
    if (!root || nestedScroller(target, root)) return
    state.mark += 1
    state.anchor = undefined
  }
  const loadOlder = () => {
    const root = scroller.current
    if (!root || !history?.more || history.loading || state.requesting) return
    if (following.current ? root.scrollHeight > root.clientHeight + 1 : root.scrollTop >= historyEdge) return
    state.requesting = true
    history.onLoadOlder()
  }
  const step = (offset: number) => {
    const marker = props.marker
    if (!marker || (offset > 0 && following.current)) return
    const markers = props.items.flatMap((item, index) => (marker(item) ? [index] : []))
    const line = (scroller.current?.scrollTop ?? 0) + markerLine
    const current = currentMarker(state, markers, keys, virtualizer.measurementsCache, line)
    const next = (current === -1 ? markers.length : current) + offset
    if (markers.length === 0 || next < 0 || next > markers.length) return
    const index = markers[next]
    if (index === undefined) return resume()
    follow(false)
    state.active = { key: keys[index] ?? "", mark: state.mark }
    virtualizer.scrollToIndex(index, { align: "start" })
  }

  useImperativeHandle(props.ref, () => ({ resume, step }))

  useLayoutEffect(() => {
    latest.current = keys
    const initial = state.known.size === 0
    for (const key of keys.filter((item) => !state.known.has(item))) {
      if (!initial) state.added.add(key)
      state.known.add(key)
    }
  })

  useLayoutEffect(() => {
    const offset = sizer.current?.offsetTop
    if (offset !== undefined) setMargin(offset)
  }, [])

  useLayoutEffect(() => {
    const resize = virtualizer.resizeItem
    const pending = new Map<number, { key: string; size: number }>()
    const batch = { scheduled: false }
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
      const first = instance.range?.startIndex
      return state.added.has(String(item.key))
        ? item.end <= (instance.scrollOffset ?? 0) + instance.scrollAdjustments + instance.options.scrollMargin
        : first !== undefined && item.index < first
    }
    virtualizer.resizeItem = (index, size) => {
      const key = String(virtualizer.options.getItemKey(index))
      if ((virtualizer.itemSizeCache.get(key) ?? estimate) === size) {
        pending.delete(index)
        return
      }
      pending.set(index, { key, size })
      if (batch.scheduled) return
      batch.scheduled = true
      queueMicrotask(() => {
        batch.scheduled = false
        const sizes = [...pending]
        pending.clear()
        for (const entry of sizes)
          if (String(virtualizer.options.getItemKey(entry[0])) === entry[1].key) resize(entry[0], entry[1].size)
        const root = scroller.current
        if (following.current && root && Math.abs(distanceFromEnd(root)) > endEpsilon) virtualizer.scrollToEnd()
        const anchored = state.anchor === undefined ? -1 : latest.current.indexOf(state.anchor)
        if (!following.current && anchored >= 0) virtualizer.scrollToIndex(anchored, { align: "start" })
      })
    }
    return () => {
      virtualizer.resizeItem = resize
      pending.clear()
    }
  }, [virtualizer, state])

  const onScroll = useEffectEvent((root: HTMLElement) => {
    const previousTop = state.scrollTop
    const previousMax = state.maxScroll
    state.scrollTop = root.scrollTop
    state.maxScroll = root.scrollHeight - root.clientHeight
    const atEnd = state.maxScroll - state.scrollTop <= endEpsilon
    const arrived = state.scrollTop > previousTop + endEpsilon || state.maxScroll < previousMax
    if (state.maxScroll <= 1 || (atEnd && arrived && state.anchor === undefined)) follow(true)
    else if ((state.pointer || state.touching) && state.scrollTop < previousTop - endEpsilon) unpin()
    schedule()
    if (!following.current) loadOlder()
  })
  const onWheel = useEffectEvent((event: WheelEvent, root: HTMLElement) => {
    markUserScroll(event.target)
    if (event.deltaY < 0 && !nestedScroller(event.target, root)) unpin()
  })
  const onKeyDown = useEffectEvent((event: KeyboardEvent, root: HTMLElement) => {
    const intent = scrollIntent(event, root)
    if (!intent) return
    markUserScroll(root)
    if (intent === "up") unpin()
  })
  const onTouchMove = useEffectEvent((event: TouchEvent) => {
    const current = event.touches[0]?.clientY
    const previous = state.touch
    if (current === undefined || previous === undefined) return
    state.touch = current
    if (current > previous && !state.touchNested) unpin()
  })
  const onTouchStart = useEffectEvent((event: TouchEvent, root: HTMLElement) => {
    markUserScroll(event.target)
    state.touching = true
    state.touch = event.touches[0]?.clientY
    state.touchNested = nestedScroller(event.target, root)
  })
  const onPointerDown = useEffectEvent((event: PointerEvent) => {
    markUserScroll(event.target)
    state.pointer = true
  })
  const onClick = useEffectEvent(() => {
    if ((window.getSelection()?.toString().length ?? 0) > 0) unpin()
  })

  useEffect(() => {
    const root = scroller.current
    if (!root) return
    const move = (event: Event) => {
      if (event instanceof TouchEvent) onTouchMove(event)
    }
    const clear = () => {
      state.touchTarget?.removeEventListener("touchmove", move)
      state.touchTarget?.removeEventListener("touchend", end)
      state.touchTarget?.removeEventListener("touchcancel", end)
      state.touchTarget = null
    }
    const end = () => {
      clear()
      state.touch = undefined
      state.touching = false
    }
    const scroll = () => onScroll(root)
    const wheel = (event: WheelEvent) => onWheel(event, root)
    const key = (event: KeyboardEvent) => onKeyDown(event, root)
    const touch = (event: TouchEvent) => {
      clear()
      onTouchStart(event, root)
      state.touchTarget = event.target
      event.target?.addEventListener("touchmove", move, { passive: true })
      event.target?.addEventListener("touchend", end, { passive: true })
      event.target?.addEventListener("touchcancel", end, { passive: true })
    }
    const pointer = (event: PointerEvent) => onPointerDown(event)
    const click = () => onClick()
    const release = () => {
      state.pointer = false
    }
    root.addEventListener("scroll", scroll, { passive: true })
    root.addEventListener("wheel", wheel, { passive: true })
    root.addEventListener("keydown", key)
    root.addEventListener("touchstart", touch, { passive: true })
    root.addEventListener("pointerdown", pointer)
    root.addEventListener("click", click)
    window.addEventListener("pointerup", release)
    window.addEventListener("pointercancel", release)
    return () => {
      clear()
      root.removeEventListener("scroll", scroll)
      root.removeEventListener("wheel", wheel)
      root.removeEventListener("keydown", key)
      root.removeEventListener("touchstart", touch)
      root.removeEventListener("pointerdown", pointer)
      root.removeEventListener("click", click)
      window.removeEventListener("pointerup", release)
      window.removeEventListener("pointercancel", release)
      if (state.frame !== undefined) cancelAnimationFrame(state.frame)
    }
  }, [state])

  useEffect(() => {
    const dock = shell.dock
    if (!dock) return
    const observer = new ResizeObserver(() => {
      const root = scroller.current
      const next = Math.ceil(dock.getBoundingClientRect().height)
      if (next === state.dock) return
      const delta = next - state.dock
      state.stick = root ? following.current || distanceFromEnd(root) < 10 + Math.max(0, delta) : false
      state.dock = next
      setDockHeight(next)
    })
    observer.observe(dock)
    return () => observer.disconnect()
  }, [shell.dock, state])

  const afterDock = useEffectEvent(() => {
    if (state.stick) virtualizer.scrollToEnd()
    state.stick = false
    schedule()
  })
  useLayoutEffect(() => afterDock(), [dockHeight])

  const populated = keys.length > 0
  const settleTick = useEffectEvent(() => {
    const root = scroller.current
    if (!root) return true
    if (following.current && Math.abs(distanceFromEnd(root)) > 1) virtualizer.scrollToEnd()
    return virtualizer.getVirtualItems().every((item) => virtualizer.elementsCache.get(item.key)?.isConnected === true)
  })
  useEffect(() => {
    if (settled || !populated) return
    const loop = { frames: 0, stable: 0, id: 0 }
    const tick = () => {
      loop.stable = settleTick() ? loop.stable + 1 : 0
      loop.frames += 1
      if (loop.stable >= 2 || loop.frames > 30) return setSettled(true)
      loop.id = requestAnimationFrame(tick)
    }
    loop.id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(loop.id)
  }, [settled, populated])

  const reveal = useEffectEvent(() => {
    if (props.target === undefined) state.revealed = undefined
    if (!settled || targetIndex < 0 || state.revealed === props.target) return
    state.revealed = props.target
    state.anchor = props.hold ? props.target : undefined
    following.current = false
    setPinned(false)
    props.onFollowChange?.(false)
    virtualizer.scrollToIndex(targetIndex, { align: "start" })
  })
  useEffect(() => reveal(), [props.target, targetIndex, settled])

  const more = history?.more === true
  const loading = history?.loading === true
  const fill = useEffectEvent(loadOlder)
  const settleRequest = useEffectEvent(() => {
    state.requesting = false
  })
  useEffect(() => {
    settleRequest()
    if (!more || loading || !settled) return
    const frame = requestAnimationFrame(fill)
    return () => cancelAnimationFrame(frame)
  }, [more, loading, settled, count, pinned])

  return (
    <>
      <section
        ref={scroller}
        data-slot="transcript-viewport"
        aria-label={props.label}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be reachable from the keyboard
        tabIndex={0}
        style={{ overflowAnchor: "none" }}
        className={composeClasses(
          "absolute inset-0 touch-pan-y scrollbar-gutter-both overflow-y-auto overscroll-contain",
          shell.populated ? "bg-background-primary" : "bg-transparent",
          shell.scrollbar === "hidden" && "scrollbar-none",
        )}
      >
        <div className="mx-auto max-w-[calc(var(--ren-container-content)-var(--ren-spacing-8))] min-w-0 px-4 pt-12 md:px-6">
          <div
            ref={sizer}
            className={composeClasses("relative w-full", !settled && populated && "invisible")}
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((row) => {
              const item = props.items.at(row.index)
              return (
                <div
                  key={row.key}
                  data-index={row.index}
                  data-row-key={row.key}
                  data-message-id={item === undefined ? undefined : props.itemMessage?.(item)}
                  id={
                    item !== undefined && props.marker?.(item) && props.itemMessage?.(item)
                      ? `message-${props.itemMessage(item)}`
                      : undefined
                  }
                  aria-busy={item !== undefined && props.itemBusy?.(item) ? true : undefined}
                  ref={virtualizer.measureElement}
                  className="absolute inset-x-0 top-0"
                  style={{ transform: `translateY(${row.start - margin}px)` }}
                >
                  <div className="pb-4 empty:hidden md:pb-6">
                    {item === undefined ? props.footer : props.renderItem(item)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>
      {loading ? (
        <div className="pointer-events-none absolute inset-x-0 top-12 z-10 flex justify-center">
          <LoadingMessage placement="inline" title="Loading earlier messages" />
        </div>
      ) : null}
      <JumpToLatest visible={jump} onActivate={resume} composerHeight={dockHeight} />
    </>
  )
}
