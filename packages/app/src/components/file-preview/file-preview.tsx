import { lazy, Suspense, useEffect, useEffectEvent, useRef, useState } from "react"
import {
  IconChevronDown,
  IconChevronUp,
  IconDownload,
  IconMinus,
  IconPlus,
  IconSearch,
  IconX,
} from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@ren/ui/dialog"
import { Input } from "@ren/ui/input"
import { Loading } from "@ren/ui/loading"
import type { SessionMessage } from "@ren/schema/session/message"
import { maxPreviewBytes } from "./preview.js"

const PdfView = lazy(() => import("./pdf.js").then((module) => ({ default: module.PdfView })))
const XlsxView = lazy(() => import("./xlsx.js").then((module) => ({ default: module.XlsxView })))

const zoomSteps = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]

type Load = { status: "loading" } | { status: "ready"; bytes: ArrayBuffer } | { status: "failed" | "gone" }

const notice = (reason: { tooLarge: boolean; load: Load }) => {
  if (reason.tooLarge) return "Too large to preview"
  if (reason.load.status === "gone") return "Not in the drive"
  return "Couldn’t preview this file"
}

const matchLabel = (query: string, count: number, active: number) => {
  if (!query.trim()) return ""
  return count === 0 ? "No matches" : `${active + 1} of ${count}`
}

function Pending() {
  return (
    <Loading className="m-6 flex-1">
      <div className="h-96" />
    </Loading>
  )
}

function FindBar(props: {
  query: string
  count: number
  active: number
  onQuery: (query: string) => void
  onMove: (delta: number) => void
  onClose: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  return (
    <div className="flex items-center gap-2 border-b px-4 py-1.5">
      <Input
        ref={input}
        aria-label="Find in file"
        placeholder="Find"
        className="h-7 max-w-64"
        value={props.query}
        onChange={(event) => props.onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            props.onMove(event.shiftKey ? -1 : 1)
          } else if (event.key === "Escape") {
            event.stopPropagation()
            event.preventDefault()
            props.onClose()
          }
        }}
      />
      <span aria-live="polite" className="text-xs text-muted-foreground tabular-nums">
        {matchLabel(props.query, props.count, props.active)}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Previous match"
        disabled={props.count === 0}
        onClick={() => props.onMove(-1)}
      >
        <IconChevronUp />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Next match"
        disabled={props.count === 0}
        onClick={() => props.onMove(1)}
      >
        <IconChevronDown />
      </Button>
    </div>
  )
}

function useBytes(bytes: (signal: AbortSignal) => Promise<ArrayBuffer>, options: { skip: boolean }) {
  const [load, setLoad] = useState<Load>({ status: "loading" })
  const fetchBytes = useEffectEvent(bytes)
  useEffect(() => {
    if (options.skip) return
    const controller = new AbortController()
    fetchBytes(controller.signal).then(
      (loaded) => setLoad({ status: "ready", bytes: loaded }),
      (error: unknown) => {
        if (!controller.signal.aborted)
          setLoad({ status: error instanceof Error && error.message === "gone" ? "gone" : "failed" })
      },
    )
    return () => controller.abort()
  }, [options.skip])
  return { load, fail: () => setLoad({ status: "failed" }) }
}

function useZoom(onFind: () => void) {
  const [zoom, setZoom] = useState<number | "fit">("fit")
  const step = (direction: 1 | -1) => {
    const current = zoom === "fit" ? 1 : zoom
    const next =
      direction === 1 ? zoomSteps.find((value) => value > current) : zoomSteps.findLast((value) => value < current)
    if (next) setZoom(next)
  }
  const keys = useEffectEvent((event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
      event.preventDefault()
      onFind()
    } else if (!(event.target instanceof HTMLInputElement) && !event.metaKey && !event.ctrlKey) {
      if (event.key === "+" || event.key === "=") step(1)
      else if (event.key === "-") step(-1)
      else if (event.key === "0") setZoom("fit")
    }
  })
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keys(event)
    window.addEventListener("keydown", listener)
    return () => window.removeEventListener("keydown", listener)
  }, [])
  return { zoom, step, reset: () => setZoom("fit") }
}

function Toolbar(props: {
  file: SessionMessage.DriveFile
  finding: boolean
  zoom: ReturnType<typeof useZoom>
  onFind: () => void
  onClose: () => void
  onDownload: () => void
}) {
  return (
    <div className="flex items-center gap-2 border-b px-4 py-2">
      <p className="min-w-0 flex-1 truncate text-sm font-medium">{props.file.name}</p>
      <DialogDescription className="sr-only">Preview of {props.file.name}</DialogDescription>
      <Button variant="ghost" size="sm" aria-pressed={props.finding} onClick={() => props.onFind()}>
        <IconSearch />
        Find
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Zoom out" onClick={() => props.zoom.step(-1)}>
        <IconMinus />
      </Button>
      <Button variant="ghost" size="sm" aria-label="Fit width" className="w-14 tabular-nums" onClick={props.zoom.reset}>
        {props.zoom.zoom === "fit" ? "Fit" : `${Math.round(props.zoom.zoom * 100)}%`}
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Zoom in" onClick={() => props.zoom.step(1)}>
        <IconPlus />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Download" onClick={props.onDownload}>
        <IconDownload />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={props.onClose}>
        <IconX />
      </Button>
    </div>
  )
}

function Viewer(props: {
  file: SessionMessage.DriveFile
  bytes: (signal: AbortSignal) => Promise<ArrayBuffer>
  onClose: () => void
  onDownload: () => void
}) {
  const tooLarge = props.file.size > maxPreviewBytes
  const { load, fail } = useBytes(props.bytes, { skip: tooLarge })
  const [finding, setFinding] = useState(false)
  const zoom = useZoom(() => setFinding(true))
  const [query, setQuery] = useState("")
  const [count, setCount] = useState(0)
  const [active, setActive] = useState(0)
  const view = {
    zoom: zoom.zoom,
    query: finding ? query : "",
    active,
    onCount: (next: number) => {
      setCount(next)
      setActive(0)
    },
    onError: fail,
  }
  const pdf = props.file.mime === "application/pdf"
  const blocked = tooLarge || load.status === "failed" || load.status === "gone"
  return (
    <>
      <Toolbar
        file={props.file}
        finding={finding}
        zoom={zoom}
        onFind={() => setFinding((on) => !on)}
        onClose={props.onClose}
        onDownload={props.onDownload}
      />
      {finding ? (
        <FindBar
          query={query}
          count={count}
          active={active}
          onQuery={setQuery}
          onMove={(delta) => setActive((current) => (count === 0 ? 0 : (current + delta + count) % count))}
          onClose={() => setFinding(false)}
        />
      ) : null}
      {blocked ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm">
          <p>{notice({ tooLarge, load })}</p>
          {load.status === "gone" ? null : (
            <Button variant="outline" size="sm" onClick={props.onDownload}>
              <IconDownload />
              Download
            </Button>
          )}
        </div>
      ) : null}
      {!blocked && load.status === "ready" ? (
        <Suspense fallback={<Pending />}>
          {pdf ? <PdfView bytes={load.bytes} {...view} /> : <XlsxView bytes={load.bytes} {...view} />}
        </Suspense>
      ) : null}
      {!blocked && load.status === "loading" ? <Pending /> : null}
    </>
  )
}

export function FilePreview(props: {
  file: SessionMessage.DriveFile
  open: boolean
  onOpenChange: (open: boolean) => void
  bytes: (signal: AbortSignal) => Promise<ArrayBuffer>
  onDownload: () => void
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(90vh,--spacing(260))] w-[min(96vw,--spacing(380))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">{props.file.name}</DialogTitle>
        <DialogDescription className="sr-only">Preview of {props.file.name}</DialogDescription>
        <Viewer
          file={props.file}
          bytes={props.bytes}
          onClose={() => props.onOpenChange(false)}
          onDownload={props.onDownload}
        />
      </DialogContent>
    </Dialog>
  )
}
