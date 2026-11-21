import { useEffect, useEffectEvent, useRef } from "react"
import { IconChevronDown, IconChevronUp, IconHistory, IconSearch, IconX } from "@tabler/icons-react"
import { Button } from "#components/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "#components/input-group"

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
  focus: number
  more: boolean
  loadingHistory: boolean
  label?: string
  scope?: () => Element | ShadowRoot | null | undefined
  onStep: (delta: number) => void
  onSearchEarlier: () => void
  onClose: () => void
}

const hitName = "ren-find-hit"
const activeName = "ren-find-active"
const bodies = "[data-searchable]"
const chatRows = { rows: "[data-row-key]", key: "data-row-key", bodies }
const lineRows = { rows: "[data-line]", key: "data-line", bodies: undefined }
const unsearchable = '.katex-mathml, [data-streamdown="mermaid-block"]'
const seekFrames = 12
const steps: Readonly<Record<string, number>> = { Enter: 1, ShiftEnter: -1, ArrowDown: 1, ArrowUp: -1 }

const supported = () => typeof CSS !== "undefined" && "highlights" in CSS

const clear = () => {
  if (!supported()) return
  CSS.highlights.delete(hitName)
  CSS.highlights.delete(activeName)
}

const special = /[.*+?^${}()|[\]\\]/g

const bodyRanges = (body: Node, pattern: RegExp) => {
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, (node) =>
    node.parentElement?.closest(unsearchable) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  )
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

const rowRanges = (row: Element, pattern: RegExp, kind: typeof chatRows | typeof lineRows) =>
  kind.bodies
    ? [...row.querySelectorAll(kind.bodies)].flatMap((body) => bodyRanges(body, pattern))
    : bodyRanges(row, pattern)

const ranges = (
  root: Element | ShadowRoot,
  query: string,
  match: FindBarMatch | undefined,
  kind: typeof chatRows | typeof lineRows,
) => {
  const pattern = new RegExp(query.replaceAll(special, "\\$&"), "gi")
  return [...root.querySelectorAll(kind.rows)].reduce<{ hits: Array<Range>; active: Array<Range> }>(
    (found, row) => {
      const current = match !== undefined && row.getAttribute(kind.key) === match.row
      const each = rowRanges(row, pattern, kind)
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
  }, [props.focus])

  const rootOf = useEffectEvent(() =>
    props.scope
      ? props.scope()
      : input.current
          ?.closest('[data-slot="message-scroller"]')
          ?.querySelector('[data-slot="message-scroller-viewport"]'),
  )
  const kind = props.scope ? lineRows : chatRows
  const label = props.label ?? "Find in chat"

  const highlight = useEffectEvent(
    (root: Element | ShadowRoot | null | undefined, options: { readonly seek: boolean }) => {
      if (!root || !query) return true
      const found = ranges(root, query, props.match, kind)
      if (supported()) {
        CSS.highlights.set(hitName, new Highlight(...found.hits))
        CSS.highlights.set(activeName, new Highlight(...found.active))
      }
      const target =
        found.active.at(0)?.startContainer.parentElement ??
        (row ? root.querySelector(`[${kind.key}="${CSS.escape(row)}"]`) : null)
      if (options.seek) target?.scrollIntoView({ block: "center" })
      return target !== null
    },
  )

  useEffect(() => {
    const root = rootOf()
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
    <div className="flex w-80 flex-col items-end gap-2">
      <search aria-label={label} className="w-full">
        <InputGroup className="bg-popover shadow-overlay">
          <InputGroupAddon>
            <IconSearch />
          </InputGroupAddon>
          <InputGroupInput
            ref={input}
            type="search"
            value={props.value}
            placeholder={label}
            aria-label={label}
            className="[&::-webkit-search-cancel-button]:appearance-none"
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
          <InputGroupAddon align="inline-end">
            {query ? (
              <output aria-live="polite" className="text-xs font-normal text-muted-foreground tabular-nums">
                {status(props.count, props.active)}
              </output>
            ) : null}
            <InputGroupButton
              size="icon-xs"
              aria-label="Previous match"
              className="text-muted-foreground"
              disabled={props.count === 0}
              onClick={() => props.onStep(-1)}
            >
              <IconChevronUp />
            </InputGroupButton>
            <InputGroupButton
              size="icon-xs"
              aria-label="Next match"
              className="text-muted-foreground"
              disabled={props.count === 0}
              onClick={() => props.onStep(1)}
            >
              <IconChevronDown />
            </InputGroupButton>
            <InputGroupButton
              size="icon-xs"
              aria-label="Close find"
              className="text-muted-foreground"
              onMouseDown={(event) => event.preventDefault()}
              onClick={props.onClose}
            >
              <IconX />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </search>
      {props.more ? (
        <Button
          variant="outline"
          size="sm"
          className="bg-popover shadow-overlay"
          disabled={props.loadingHistory}
          onClick={props.onSearchEarlier}
        >
          <IconHistory />
          Search earlier messages
        </Button>
      ) : null}
    </div>
  )
}
