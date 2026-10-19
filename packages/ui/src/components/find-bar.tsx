import { useEffect, useEffectEvent, useRef } from "react"
import { Icon } from "./icon.js"
import { IconButton } from "./icon-button.js"
import { TextField } from "./text-field.js"

export type FindBarMatch = {
  row: string
  occurrence: number
}

export type FindBarProps = {
  value: string
  onValueChange: (value: string) => void
  count: number
  active: number
  match?: FindBarMatch | undefined
  onStep: (delta: number) => void
  onClose: () => void
}

const hitName = "ren-find-hit"
const activeName = "ren-find-active"
const bodies = '[data-slot="message-bubble"], [data-searchable]'
const seekFrames = 12
const steps: Readonly<Record<string, number>> = { Enter: 1, ShiftEnter: -1, ArrowDown: 1, ArrowUp: -1 }

const supported = () => typeof CSS !== "undefined" && "highlights" in CSS

const clear = () => {
  if (!supported()) return
  CSS.highlights.delete(hitName)
  CSS.highlights.delete(activeName)
}

const textNodes = (body: Element) => {
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
  const nodes: Array<Text> = []
  while (walker.nextNode()) if (walker.currentNode instanceof Text) nodes.push(walker.currentNode)
  return nodes
}

const offsets = (value: string, query: string): ReadonlyArray<number> => {
  const at = value.indexOf(query)
  return at === -1
    ? []
    : [at, ...offsets(value.slice(at + query.length), query).map((next) => next + at + query.length)]
}

const rowRanges = (row: Element, query: string) =>
  [...row.querySelectorAll(bodies)].flatMap((body) =>
    textNodes(body).flatMap((node) =>
      offsets((node.nodeValue ?? "").toLowerCase(), query).map((at) => {
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + query.length)
        return range
      }),
    ),
  )

const ranges = (root: Element, query: string, match: FindBarMatch | undefined) => {
  const lower = query.toLowerCase()
  return [...root.querySelectorAll("[data-row-key]")].reduce<{ hits: Array<Range>; active: Array<Range> }>(
    (found, row) => {
      const current = match !== undefined && row.getAttribute("data-row-key") === match.row
      const each = rowRanges(row, lower)
      found.hits.push(...each.filter((_range, index) => !current || index !== match.occurrence))
      found.active.push(...each.filter((_range, index) => current && index === match.occurrence))
      return found
    },
    { hits: [], active: [] },
  )
}

const status = (count: number, active: number) =>
  count === 0 ? "No results" : `${Math.min(active, count - 1) + 1}/${count}`

export function FindBar(props: FindBarProps) {
  const input = useRef<HTMLInputElement>(null)
  const query = props.value.trim()
  const row = props.match?.row
  const occurrence = props.match?.occurrence

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  const highlight = useEffectEvent((seek: boolean) => {
    const root = input.current
      ?.closest('[data-slot="conversation-shell"]')
      ?.querySelector('[data-slot="transcript-viewport"]')
    if (!root || !query || !supported()) return true
    const found = ranges(root, query, props.match)
    CSS.highlights.set(hitName, new Highlight(...found.hits))
    CSS.highlights.set(activeName, new Highlight(...found.active))
    const first = found.active.at(0)
    if (!seek || !first) return first !== undefined
    first.startContainer.parentElement?.scrollIntoView({ block: "center" })
    return true
  })

  useEffect(() => {
    const root = input.current
      ?.closest('[data-slot="conversation-shell"]')
      ?.querySelector('[data-slot="transcript-viewport"]')
    const loop = { frame: 0, tries: 0, apply: 0 }
    const seek = () => {
      if (highlight(true) || loop.tries++ >= seekFrames) return
      loop.frame = requestAnimationFrame(seek)
    }
    loop.frame = requestAnimationFrame(seek)
    const observer = new MutationObserver(() => {
      if (loop.apply) return
      loop.apply = requestAnimationFrame(() => {
        loop.apply = 0
        highlight(false)
      })
    })
    if (root) observer.observe(root, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      cancelAnimationFrame(loop.frame)
      cancelAnimationFrame(loop.apply)
      clear()
    }
  }, [query, row, occurrence])

  return (
    <search
      aria-label="Find in chat"
      className="flex min-w-0 items-center gap-1 rounded-control border border-border-primary bg-background-secondary p-1 shadow-overlay"
    >
      <span className="w-48 min-w-0">
        <TextField
          ref={input}
          type="search"
          size="small"
          appearance="filled"
          width="full"
          value={props.value}
          placeholder="Find in chat"
          aria-label="Find in chat"
          leading={<Icon glyph="Search" />}
          onChange={(event) => props.onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              props.onClose()
              return
            }
            if (event.nativeEvent.isComposing || event.altKey || event.metaKey || event.ctrlKey) return
            const delta = steps[event.shiftKey && event.key === "Enter" ? "ShiftEnter" : event.key]
            if (delta === undefined) return
            event.preventDefault()
            props.onStep(delta)
          }}
        />
      </span>
      {query ? (
        <output aria-live="polite" className="shrink-0 px-1 text-xs text-text-secondary tabular-nums">
          {status(props.count, props.active)}
        </output>
      ) : null}
      <IconButton label="Previous match" size="small" disabled={props.count === 0} onClick={() => props.onStep(-1)}>
        <Icon glyph="ChevronUp" />
      </IconButton>
      <IconButton label="Next match" size="small" disabled={props.count === 0} onClick={() => props.onStep(1)}>
        <Icon glyph="ChevronDown" />
      </IconButton>
      <IconButton
        label="Close find"
        size="small"
        onMouseDown={(event) => event.preventDefault()}
        onClick={props.onClose}
      >
        <Icon glyph="X" />
      </IconButton>
    </search>
  )
}
