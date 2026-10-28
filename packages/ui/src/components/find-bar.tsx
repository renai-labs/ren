import { useEffect, useEffectEvent, useRef } from "react"
import { Button } from "./button.js"
import { Icon } from "./icon.js"
import { InputGroup, InputGroupAddon, InputGroupInput } from "./input-group.js"

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

const special = /[.*+?^${}()|[\]\\]/g

const bodyRanges = (body: Element, pattern: RegExp) => {
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
  const nodes: Array<{ node: Text; start: number }> = []
  const text = { value: "" }
  while (walker.nextNode())
    if (walker.currentNode instanceof Text) {
      nodes.push({ node: walker.currentNode, start: text.value.length })
      text.value += walker.currentNode.data
    }
  const at = (offset: number) => {
    const found = nodes.findLast((entry) => entry.start <= offset) ?? nodes[0]
    return found && { node: found.node, offset: Math.min(offset - found.start, found.node.length) }
  }
  return [...text.value.matchAll(pattern)].flatMap((found) => {
    const start = at(found.index)
    const end = at(found.index + found[0].length)
    if (!start || !end) return []
    const range = document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    return [range]
  })
}

const rowRanges = (row: Element, pattern: RegExp) =>
  [...row.querySelectorAll(bodies)].flatMap((body) => bodyRanges(body, pattern))

const ranges = (root: Element, query: string, match: FindBarMatch | undefined) => {
  const pattern = new RegExp(query.replaceAll(special, "\\$&"), "gi")
  return [...root.querySelectorAll("[data-row-key]")].reduce<{ hits: Array<Range>; active: Array<Range> }>(
    (found, row) => {
      const current = match !== undefined && row.getAttribute("data-row-key") === match.row
      const each = rowRanges(row, pattern)
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

  const highlight = useEffectEvent((root: Element | null | undefined, options: { readonly seek: boolean }) => {
    if (!root || !query || !supported()) return true
    const found = ranges(root, query, props.match)
    CSS.highlights.set(hitName, new Highlight(...found.hits))
    CSS.highlights.set(activeName, new Highlight(...found.active))
    const first = found.active.at(0)
    if (!options.seek || !first) return first !== undefined
    first.startContainer.parentElement?.scrollIntoView({ block: "center" })
    return true
  })

  useEffect(() => {
    const root = input.current
      ?.closest('[data-slot="conversation-shell"]')
      ?.querySelector('[data-slot="transcript-viewport"]')
    const loop = { frame: 0, tries: 0, apply: 0 }
    const seek = () => {
      if (highlight(root, { seek: true }) || loop.tries++ >= seekFrames) return
      loop.frame = requestAnimationFrame(seek)
    }
    loop.frame = requestAnimationFrame(seek)
    const observer = new MutationObserver(() => {
      if (loop.apply) return
      loop.apply = requestAnimationFrame(() => {
        loop.apply = 0
        highlight(root, { seek: false })
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
      <InputGroup className="h-7 w-48 min-w-0 border-0 bg-muted inset-ring inset-ring-transparent transition-colors hover:bg-secondary has-[[data-slot=input-group-control]:focus-visible]:inset-ring-ring dark:bg-muted">
        <InputGroupAddon className="pl-3">
          <Icon glyph="Search" />
        </InputGroupAddon>
        <InputGroupInput
          ref={input}
          type="search"
          value={props.value}
          placeholder="Find in chat"
          aria-label="Find in chat"
          className="h-full pl-1 [&::-webkit-search-cancel-button]:appearance-none"
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
      </InputGroup>
      {query ? (
        <output aria-live="polite" className="shrink-0 px-1 text-xs text-text-secondary tabular-nums">
          {status(props.count, props.active)}
        </output>
      ) : null}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Previous match"
        className="text-muted-foreground"
        disabled={props.count === 0}
        onClick={() => props.onStep(-1)}
      >
        <Icon glyph="ChevronUp" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Next match"
        className="text-muted-foreground"
        disabled={props.count === 0}
        onClick={() => props.onStep(1)}
      >
        <Icon glyph="ChevronDown" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Close find"
        className="text-muted-foreground"
        onMouseDown={(event) => event.preventDefault()}
        onClick={props.onClose}
      >
        <Icon glyph="X" />
      </Button>
    </search>
  )
}
