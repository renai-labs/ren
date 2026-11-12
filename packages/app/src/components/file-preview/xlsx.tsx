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

const columnName = (index: number): string =>
  (index < 26 ? "" : columnName(Math.floor(index / 26) - 1)) + String.fromCharCode(65 + (index % 26))

export function XlsxView(props: PreviewProps) {
  const [tabs, setTabs] = useState<typeof SheetTabs.Type>([])
  const [tab, setTab] = useState(0)
  const [loaded, setLoaded] = useState<Loaded>()
  const client = useRef<ReturnType<typeof workerCalls>>(undefined)
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
  const needle = props.query.trim().toLowerCase()
  const hits = needle
    ? (sheet?.rows ?? []).flatMap((row, r) =>
        row.flatMap((cell, c) => (cell.toLowerCase().includes(needle) ? [`${r}:${c}`] : [])),
      )
    : []
  const hitKey = hits.join(",")
  const total = hits.length
  useEffect(() => count(total), [hitKey, total])
  const grid = useRef<HTMLDivElement>(null)
  useEffect(() => {
    grid.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "center", inline: "center" })
  }, [hitKey, props.active])
  const columns = sheet?.rows.reduce((most, row) => Math.max(most, row.length), 0) ?? 0
  const current = hits[props.active]
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={grid} className="min-h-0 flex-1 overflow-auto overscroll-contain bg-background">
        {sheet ? (
          <div
            className="w-max"
            // oxlint-disable-next-line react/forbid-dom-props -- the zoom level is a number the user picks
            style={{ zoom: props.zoom === "fit" ? 1 : props.zoom }}
          >
            <Table className="w-max text-xs">
              <TableHeader className="sticky top-0 z-10 bg-muted">
                <TableRow>
                  <TableHead className="sticky left-0 z-20 w-12 bg-muted" />
                  {Array.from({ length: columns }, (_, c) => (
                    <TableHead key={columnName(c)} className="px-2 py-1 font-medium text-muted-foreground">
                      {columnName(c)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sheet.rows.map((row, r) => (
                  // oxlint-disable-next-line react/no-array-index-key -- a row has no identity but its position
                  <TableRow key={r}>
                    <TableHead className="sticky left-0 z-10 bg-muted px-2 py-1 text-right font-medium text-muted-foreground tabular-nums">
                      {r + 1}
                    </TableHead>
                    {Array.from({ length: columns }, (_, c) => (
                      <TableCell
                        key={columnName(c)}
                        data-active={current === `${r}:${c}`}
                        className={cn(
                          "max-w-80 truncate px-2 py-1",
                          hits.includes(`${r}:${c}`) && "bg-yellow-300/70 dark:bg-yellow-500/40",
                          current === `${r}:${c}` && "bg-orange-400/80",
                        )}
                      >
                        {row[c]}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
