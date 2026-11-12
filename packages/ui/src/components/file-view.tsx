import { useDeferredValue, useEffect, useEffectEvent, useRef, useState, type ReactNode, type RefObject } from "react"
import { File, Virtualizer } from "@pierre/diffs/react"
import { IconSearch, IconTextWrap } from "@tabler/icons-react"
import { Button } from "#components/button"
import { FindBar } from "#components/find-bar"
import { Toggle } from "#components/toggle"

const virtualizeAbove = 200
const flashMs = 1500
const seekFrames = 30
const lineHeight = 20

const viewCSS = `
  * { --diffs-bg: var(--background) !important; }
  ::highlight(ren-find-hit) { background-color: var(--find-hit); }
  ::highlight(ren-find-active) { background-color: var(--find-active); color: var(--background); }
`

const shadowOf = (host: HTMLElement | null) =>
  [...(host?.querySelectorAll("*") ?? [])].find((element) => element.shadowRoot)?.shadowRoot

const reveal = (host: HTMLElement | null, line: number) => {
  const loop = { frame: 0, tries: 0 }
  const seek = () => {
    const target = shadowOf(host)?.querySelector(`[data-line="${line}"]`)
    if (target) return target.scrollIntoView({ block: "center" })
    const scroller = host?.firstElementChild
    if (scroller && loop.tries === 0)
      scroller.scrollTop = Math.max(0, (line - 1) * lineHeight - scroller.clientHeight / 2)
    if (loop.tries++ < seekFrames) loop.frame = requestAnimationFrame(seek)
  }
  loop.frame = requestAnimationFrame(seek)
  return () => cancelAnimationFrame(loop.frame)
}

const occurrences = (contents: string, query: string) => {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  return contents.split("\n").flatMap((text, index) => {
    const lower = text.toLowerCase()
    const found: Array<{ line: number; occurrence: number }> = []
    for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length))
      found.push({ line: index + 1, occurrence: found.length })
    return found
  })
}

const useFlash = (host: RefObject<HTMLDivElement | null>, path: string, line: number | undefined) => {
  const key = `${path}:${line}`
  const [expired, setExpired] = useState<string>()
  useEffect(() => {
    if (line === undefined) return
    const stop = reveal(host.current, line)
    const timer = setTimeout(() => setExpired(key), flashMs)
    return () => {
      stop()
      clearTimeout(timer)
    }
  }, [host, key, line])
  return line !== undefined && expired !== key ? line : undefined
}

const useFind = (host: RefObject<HTMLDivElement | null>, contents: string) => {
  const [find, setFind] = useState<{ value: string; active: number; focus: number }>()
  const query = useDeferredValue(find?.value ?? "")
  const matches = occurrences(contents, query)
  const active = matches.length === 0 ? 0 : (((find?.active ?? 0) % matches.length) + matches.length) % matches.length
  const match = find ? matches[active] : undefined
  const line = match?.line
  const occurrence = match?.occurrence
  useEffect(() => (line === undefined ? undefined : reveal(host.current, line)), [host, line, occurrence])
  return {
    find,
    setFind,
    matches,
    active,
    match,
    open: () => setFind((previous) => ({ value: "", active: 0, ...previous, focus: (previous?.focus ?? 0) + 1 })),
  }
}

export function FileView(props: {
  path: string
  contents: string
  highlight: boolean
  theme: "system" | "light" | "dark"
  wrap: boolean
  onWrapChange: (wrap: boolean) => void
  line?: number | undefined
  breadcrumb: ReactNode
  meta: ReactNode
  actions: ReactNode
}) {
  const host = useRef<HTMLDivElement>(null)
  const flash = useFlash(host, props.path, props.line)
  const finder = useFind(host, props.contents)
  const find = finder.find
  const lineCount = props.contents.split("\n").length

  const view = useRef<HTMLElement>(null)
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key.toLowerCase() !== "f" || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
    event.preventDefault()
    event.stopPropagation()
    finder.open()
  })
  useEffect(() => {
    const element = view.current
    element?.addEventListener("keydown", onKeyDown)
    return () => element?.removeEventListener("keydown", onKeyDown)
  }, [])

  const file = (
    <File
      file={{ name: props.path, contents: props.contents, ...(props.highlight ? {} : { lang: "text" as const }) }}
      selectedLines={flash === undefined ? null : { start: flash, end: flash }}
      options={{
        theme: { dark: "pierre-dark", light: "pierre-light" },
        themeType: props.theme,
        overflow: props.wrap ? "wrap" : "scroll",
        disableFileHeader: true,
        unsafeCSS: viewCSS,
      }}
      className="bg-transparent!"
    />
  )

  return (
    <section ref={view} aria-label="File viewer" data-slot="file-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 px-3">
        <div className="min-w-0 flex-1">{props.breadcrumb}</div>
        <Toggle
          size="sm"
          aria-label="Wrap lines"
          pressed={props.wrap}
          onPressedChange={props.onWrapChange}
          className="text-muted-foreground"
        >
          <IconTextWrap />
        </Toggle>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Find in file"
          className="text-muted-foreground"
          onClick={finder.open}
        >
          <IconSearch />
        </Button>
        {props.actions}
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{props.meta}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col border-t">
        {find ? (
          <div className="flex shrink-0 justify-end border-b px-3 py-1.5">
            <FindBar
              label="Find in file"
              scope={() => shadowOf(host.current)}
              value={find.value}
              onValueChange={(value) => finder.setFind({ ...find, value, active: 0 })}
              count={finder.matches.length}
              active={finder.active}
              match={finder.match && { row: String(finder.match.line), occurrence: finder.match.occurrence }}
              focus={find.focus}
              more={false}
              loadingHistory={false}
              onStep={(delta) => finder.setFind({ ...find, active: finder.active + delta })}
              onSearchEarlier={() => undefined}
              onClose={() => finder.setFind(undefined)}
            />
          </div>
        ) : null}
        <div ref={host} tabIndex={-1} className="flex min-h-0 flex-1 flex-col">
          {lineCount > virtualizeAbove ? (
            <Virtualizer className="min-h-0 flex-1 overflow-auto overscroll-contain">{file}</Virtualizer>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto overscroll-contain">{file}</div>
          )}
        </div>
      </div>
    </section>
  )
}
