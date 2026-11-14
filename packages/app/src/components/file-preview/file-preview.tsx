import { lazy, Suspense, useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
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
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@ren/ui/input-group"
import { Loading } from "@ren/ui/loading"
import type { SessionMessage } from "@ren/schema/session/message"
import { errorStatus } from "../../lib/errors.js"
import { maxPreviewBytes, type Kind } from "./preview.js"

const views = {
  pdf: lazy(() => import("./pdf.js").then((module) => ({ default: module.PdfView }))),
  docx: lazy(() => import("./docx.js").then((module) => ({ default: module.DocxView }))),
  pptx: lazy(() => import("./pptx.js").then((module) => ({ default: module.PptxView }))),
  xlsx: lazy(() => import("./xlsx.js").then((module) => ({ default: module.XlsxView }))),
}

const zoomSteps = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]

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
  focus: number
  query: string
  count: number
  active: number
  onQuery: (query: string) => void
  onMove: (delta: number) => void
  onClose: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [props.focus])
  return (
    <InputGroup className="h-7 w-72">
      <InputGroupAddon>
        <IconSearch />
      </InputGroupAddon>
      <InputGroupInput
        ref={input}
        aria-label="Find in file"
        placeholder="Find"
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
      <InputGroupAddon align="inline-end">
        <span aria-live="polite" className="text-xs font-normal text-muted-foreground tabular-nums">
          {matchLabel(props.query, props.count, props.active)}
        </span>
        <InputGroupButton
          size="icon-xs"
          aria-label="Previous match"
          disabled={props.count === 0}
          onClick={() => props.onMove(-1)}
        >
          <IconChevronUp />
        </InputGroupButton>
        <InputGroupButton
          size="icon-xs"
          aria-label="Next match"
          disabled={props.count === 0}
          onClick={() => props.onMove(1)}
        >
          <IconChevronDown />
        </InputGroupButton>
        <InputGroupButton size="icon-xs" aria-label="Hide find" onClick={props.onClose}>
          <IconX />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
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
      event.stopPropagation()
      onFind()
    } else if (!(event.target instanceof HTMLInputElement) && !event.metaKey && !event.ctrlKey) {
      if (event.key === "+" || event.key === "=") step(1)
      else if (event.key === "-") step(-1)
      else if (event.key === "0") setZoom("fit")
    }
  })
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keys(event)
    window.addEventListener("keydown", listener, { capture: true })
    return () => window.removeEventListener("keydown", listener, { capture: true })
  }, [])
  return { zoom, step, reset: () => setZoom("fit") }
}

function Toolbar(props: {
  file: SessionMessage.DriveFile
  find: ReactNode
  zoom: ReturnType<typeof useZoom>
  onFind: () => void
  onClose: () => void
  onDownload: () => void
}) {
  return (
    <div className="flex h-11 items-center gap-1 border-b px-3">
      <p className="min-w-0 flex-1 truncate px-1 text-sm font-medium">{props.file.name}</p>
      {props.find ?? (
        <Button variant="ghost" size="icon-sm" aria-label="Find" onClick={() => props.onFind()}>
          <IconSearch />
        </Button>
      )}
      <Button variant="ghost" size="icon-sm" aria-label="Zoom out" onClick={() => props.zoom.step(-1)}>
        <IconMinus />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Fit width"
        className="w-12 px-0 tabular-nums"
        onClick={props.zoom.reset}
      >
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

const notices = { large: "Too large to preview", gone: "Not in the drive", failed: "Couldn't preview this file" }

const reasonOf = (state: { tooLarge: boolean; gone: boolean }) => {
  if (state.tooLarge) return "large"
  return state.gone ? "gone" : "failed"
}

function Blocked(props: { reason: keyof typeof notices; onDownload: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm">
      <p>{notices[props.reason]}</p>
      {props.reason === "gone" ? null : (
        <Button variant="outline" size="sm" onClick={props.onDownload}>
          <IconDownload />
          Download
        </Button>
      )}
    </div>
  )
}

export function Viewer(props: {
  kind: Kind
  file: SessionMessage.DriveFile
  bytes: (signal: AbortSignal) => Promise<ArrayBuffer>
  onClose: () => void
  onDownload: () => void
}) {
  const tooLarge = props.file.size > maxPreviewBytes
  const loaded = useQuery({
    // ast-grep-ignore: no-query-key-literal -- reads the file's bytes through its signed drive link, not the API
    queryKey: ["file-preview", props.file.path, props.file.size],
    queryFn: (context) => props.bytes(context.signal),
    enabled: !tooLarge,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  })
  const [broken, setBroken] = useState(false)
  const gone = errorStatus(loaded.error) === 404
  const View = views[props.kind]
  const [finding, setFinding] = useState(false)
  const [focus, setFocus] = useState(0)
  const zoom = useZoom(() => {
    setFinding(true)
    setFocus((count) => count + 1)
  })
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
    onError: () => setBroken(true),
  }
  const blocked = tooLarge || broken || loaded.isError
  return (
    <>
      <Toolbar
        file={props.file}
        find={
          finding ? (
            <FindBar
              focus={focus}
              query={query}
              count={count}
              active={active}
              onQuery={setQuery}
              onMove={(delta) => setActive((current) => (count === 0 ? 0 : (current + delta + count) % count))}
              onClose={() => setFinding(false)}
            />
          ) : undefined
        }
        zoom={zoom}
        onFind={() => setFinding(true)}
        onClose={props.onClose}
        onDownload={props.onDownload}
      />
      {blocked ? <Blocked reason={reasonOf({ tooLarge, gone })} onDownload={props.onDownload} /> : null}
      {!blocked && loaded.data ? (
        <Suspense fallback={<Pending />}>
          <View bytes={loaded.data} {...view} />
        </Suspense>
      ) : null}
      {!blocked && !loaded.data ? <Pending /> : null}
    </>
  )
}

export function FilePreview(props: {
  kind: Kind | undefined
  file: SessionMessage.DriveFile
  open: boolean
  onOpenChange: (open: boolean) => void
  bytes: (signal: AbortSignal) => Promise<ArrayBuffer>
  onDownload: () => void
}) {
  if (!props.kind) return null
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(90vh,--spacing(260))] w-[min(96vw,--spacing(380))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">{props.file.name}</DialogTitle>
        <DialogDescription className="sr-only">Preview of {props.file.name}</DialogDescription>
        <Viewer
          kind={props.kind}
          file={props.file}
          bytes={props.bytes}
          onClose={() => props.onOpenChange(false)}
          onDownload={props.onDownload}
        />
      </DialogContent>
    </Dialog>
  )
}
