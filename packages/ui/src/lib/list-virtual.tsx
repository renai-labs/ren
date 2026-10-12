import { useVirtualizer } from "@tanstack/react-virtual"
import { useRef } from "react"
import type { ReactNode } from "react"
import { composeClasses } from "./compose-classes.js"
import { listChrome, listLayout } from "./list-chrome.js"
import { ListStatus } from "./list-status.js"
import type { ListFrame } from "./list-chrome.js"
import type { ListStatusProps } from "./list-status.js"

export type VirtualProps<Item> = ListStatusProps & {
  items: ReadonlyArray<Item>
  itemKey: (item: Item) => string
  estimateSize: number
  // oxlint-disable-next-line ren/no-render-props -- hands each virtualized item back to the caller
  renderItem: (item: Item) => ReactNode
  frame?: ListFrame
  label?: string
}

export function Virtual<Item>(props: VirtualProps<Item>) {
  const scroller = useRef<HTMLDivElement>(null)
  // oxlint-disable-next-line react/incompatible-library -- the React Compiler skips this component, so the mutable virtualizer instance is read fresh on every render
  const virtualizer = useVirtualizer({
    count: props.items.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => props.estimateSize,
    getItemKey: (index) => {
      const item = props.items.at(index)
      return item === undefined ? index : props.itemKey(item)
    },
    gap: (props.frame ?? "plain") === "plain" ? 4 : 0,
    overscan: 6,
  })
  const requested = props.state ?? "ready"
  const state = requested === "ready" && props.items.length === 0 ? "empty" : requested
  if (state !== "ready") {
    return (
      <div
        data-slot="list"
        className={composeClasses(listChrome({ frame: props.frame }), listLayout({ frame: props.frame }))}
      >
        <ListStatus {...props} state={state} />
      </div>
    )
  }
  const rows = virtualizer.getVirtualItems()
  return (
    <div
      ref={scroller}
      data-slot="list"
      data-virtual=""
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- rows sit in positioned wrappers, so the scroller cannot be a <ul>
      role="list"
      aria-label={props.label}
      className={composeClasses(
        listChrome({ frame: props.frame }),
        "h-full min-h-0 flex-1 overflow-y-auto overscroll-contain",
      )}
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        <div
          className={composeClasses(listLayout({ frame: props.frame }), "absolute inset-x-0 top-0")}
          style={{ transform: `translateY(${rows.at(0)?.start ?? 0}px)` }}
        >
          {rows.flatMap((row) => {
            const item = props.items.at(row.index)
            if (item === undefined) return []
            return [
              <div key={row.key} data-index={row.index} ref={virtualizer.measureElement}>
                {props.renderItem(item)}
              </div>,
            ]
          })}
        </div>
      </div>
    </div>
  )
}
