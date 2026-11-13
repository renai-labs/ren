import { useEffect, useEffectEvent, useRef, useState } from "react"
import { Schema } from "effect"
import { Button } from "@ren/ui/button"
import { Loading } from "@ren/ui/loading"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { cn } from "cn"
import { Sheet, SheetTabs, type PreviewProps } from "./preview.js"
import { workerCalls } from "./worker-call.js"

const decodeTabs = Schema.decodeUnknownSync(SheetTabs)
const decodeSheet = Schema.decodeUnknownSync(Sheet)

type Loaded = { tab: number; sheet: typeof Sheet.Type }
type Rows = readonly (readonly string[])[]

const rowHeight = 28
const overscan = 12

const columnName = (index: number): string =>
  (index < 26 ? "" : columnName(Math.floor(index / 26) - 1)) + String.fromCharCode(65 + (index % 26))

const findCells = (rows: Rows, needle: string) =>
  needle
    ? rows.flatMap((row, r) => row.flatMap((cell, c) => (cell.toLowerCase().includes(needle) ? [`${r}:${c}`] : [])))
    : []

const rowsWidth = (rows: Rows) => rows.reduce((most, row) => Math.max(most, row.length), 0)

function Spacer(props: { columns: number; height: number }) {
  return (
    <TableRow aria-hidden className="border-0">
      <TableCell
        colSpan={props.columns + 1}
        className="p-0"
        // oxlint-disable-next-line react/forbid-component-props -- the spacer stands for the rows outside the window
        style={{ height: props.height }}
      />
    </TableRow>
  )
}

function Grid(props: {
  rows: Rows
  columns: number
  first: number
  last: number
  hitSet: ReadonlySet<string>
  current: string | undefined
}) {
  return (
    <Table className="w-max text-xs">
      <TableHeader className="sticky top-0 z-10 bg-muted">
        <TableRow>
          <TableHead className="sticky left-0 z-20 h-7 w-12 border-r bg-muted" />
          {Array.from({ length: props.columns }, (_, c) => (
            <TableHead key={columnName(c)} className="h-7 border-r px-2 py-0 font-medium text-muted-foreground">
              {columnName(c)}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.first > 0 ? <Spacer columns={props.columns} height={props.first * rowHeight} /> : null}
        {props.rows.slice(props.first, props.last).map((row, offset) => {
          const r = props.first + offset
          return (
            <TableRow key={r} className="h-7">
              <TableHead className="sticky left-0 z-10 h-7 border-r bg-muted px-2 py-0 text-right font-medium text-muted-foreground tabular-nums">
                {r + 1}
              </TableHead>
              {Array.from({ length: props.columns }, (_, c) => (
                <TableCell
                  key={columnName(c)}
                  data-active={props.current === `${r}:${c}`}
                  className={cn(
                    "h-7 max-w-80 truncate border-r px-2 py-0",
                    props.hitSet.has(`${r}:${c}`) && "bg-yellow-300/70 dark:bg-yellow-500/40",
                    props.current === `${r}:${c}` && "bg-orange-400/80",
                  )}
                >
                  {row[c]}
                </TableCell>
              ))}
            </TableRow>
          )
        })}
        {props.last < props.rows.length ? (
          <Spacer columns={props.columns} height={(props.rows.length - props.last) * rowHeight} />
        ) : null}
      </TableBody>
    </Table>
  )
}

export function XlsxView(props: PreviewProps) {
  const [tabs, setTabs] = useState<typeof SheetTabs.Type>([])
  const [tab, setTab] = useState(0)
  const [loaded, setLoaded] = useState<Loaded>()
  const [view, setView] = useState({ top: 0, height: 600 })
  const client = useRef<ReturnType<typeof workerCalls>>(undefined)
  const grid = useRef<HTMLDivElement>(null)
  const fail = useEffectEvent(props.onError)
  const count = useEffectEvent(props.onCount)
  useEffect(() => {
    const calls = workerCalls(() => new Worker(new URL("./xlsx.worker.ts", import.meta.url), { type: "module" }))
    client.current = calls
    calls.call({ type: "open", bytes: structuredClone(props.bytes) }).then((opened) => {
      const found = decodeTabs(opened)
      setTabs(found)
      setTab(found[0]?.index ?? 0)
    }, fail)
    return () => calls.close()
  }, [props.bytes])
  useEffect(() => {
    if (tabs.length === 0) return
    const cancelled = { value: false }
    client.current?.call({ type: "sheet", index: tab }).then(
      (read) => {
        if (!cancelled.value) setLoaded({ tab, sheet: decodeSheet(read) })
      },
      () => {
        if (!cancelled.value) fail()
      },
    )
    return () => {
      cancelled.value = true
    }
  }, [tabs, tab])
  const sheet = loaded?.tab === tab ? loaded.sheet : undefined
  const rows = sheet?.rows ?? []
  const hits = findCells(rows, props.query.trim().toLowerCase())
  const hitKey = hits.join(",")
  const total = hits.length
  useEffect(() => count(total), [hitKey, total])
  const rowPx = rowHeight * (props.zoom === "fit" ? 1 : props.zoom)
  const current = hits[props.active]
  const reveal = useEffectEvent((key: string) => {
    grid.current?.scrollTo({ top: Math.max(0, Number(key.split(":")[0]) * rowPx - view.height / 2) })
    setTimeout(
      () => grid.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest", inline: "center" }),
      50,
    )
  })
  useEffect(() => {
    if (current) reveal(current)
  }, [current])
  useEffect(() => {
    const element = grid.current
    if (!element) return
    // ast-grep-ignore: no-manual-scroll -- measures the grid to render only the rows in view, not a chat
    const observer = new ResizeObserver(() => setView((previous) => ({ ...previous, height: element.clientHeight })))
    observer.observe(element)
    return () => observer.disconnect()
  }, [sheet])
  const first = Math.max(0, Math.floor(view.top / rowPx) - overscan)
  const last = Math.min(rows.length, Math.ceil((view.top + view.height) / rowPx) + overscan)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={grid}
        className="min-h-0 flex-1 overflow-auto overscroll-contain bg-background"
        onScroll={(event) => setView({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })}
      >
        {sheet ? (
          <div
            className="w-max [&_[data-slot=table-container]]:overflow-visible"
            // oxlint-disable-next-line react/forbid-dom-props -- the zoom level is a number the user picks
            style={{ zoom: props.zoom === "fit" ? 1 : props.zoom }}
          >
            <Grid
              rows={rows}
              columns={rowsWidth(rows)}
              first={first}
              last={last}
              hitSet={new Set(hits)}
              current={current}
            />
          </div>
        ) : (
          <Loading className="m-6 h-2/3">
            <div className="h-96" />
          </Loading>
        )}
        {sheet?.truncated ? (
          <p className="sticky left-0 p-3 text-xs text-muted-foreground">
            Showing the first 10,000 rows of this sheet.
          </p>
        ) : null}
      </div>
      <div role="tablist" className="flex gap-1 overflow-x-auto overscroll-contain border-t px-2 py-1.5">
        {tabs.map((item) => (
          <Button
            key={item.index}
            variant="ghost"
            size="sm"
            role="tab"
            aria-selected={tab === item.index}
            onClick={() => setTab(item.index)}
            className={cn("text-muted-foreground", tab === item.index && "bg-muted font-medium text-foreground")}
          >
            {item.name}
          </Button>
        ))}
      </div>
    </div>
  )
}
