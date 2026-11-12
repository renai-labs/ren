import { useEffect, useRef, useState } from "react"
import type { KeyboardEvent, PointerEvent, RefObject } from "react"
import { Button } from "@ren/ui/button"
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@ren/ui/dialog"
import { toast } from "@ren/ui/sonner"
import {
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconDownload,
  IconExternalLink,
  IconMinus,
  IconPlus,
  IconX,
} from "@tabler/icons-react"
import { cn } from "cn"
import { Platform } from "../platform/platform.js"
import { ImageZoom } from "./image-zoom.js"

export interface Item {
  readonly key: string
  readonly src: string
  readonly name: string
  readonly download?: (() => void) | undefined
}

const swipeDistance = 60

const iconButton = "text-white hover:bg-white/15 hover:text-white"

function dataBlob(src: string) {
  const comma = src.indexOf(",")
  const header = src.slice(5, comma)
  const bytes = Uint8Array.from(atob(src.slice(comma + 1)), (character) => character.charCodeAt(0))
  return new Blob([bytes], { type: header.replace(/;base64$/u, "") })
}

function loadPng(src: string) {
  return new Promise<Blob>((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = "anonymous"
    image.onerror = () => reject(new Error("image failed to load"))
    image.onload = () => {
      const canvas = document.createElement("canvas")
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      canvas.getContext("2d")?.drawImage(image, 0, 0)
      canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("encode failed"))), "image/png")
    }
    image.src = src
  })
}

function useImageActions(item: Item) {
  const platform = Platform.usePlatform()
  const copy = () => {
    const write = platform.copyImage
    if (!write) return
    void loadPng(item.src)
      .then(write)
      .then(
        () => toast.success("Image copied"),
        () => toast.error("Couldn't copy the image"),
      )
  }
  const save = () => {
    if (item.download) {
      item.download()
      return
    }
    const extension = /^data:image\/([a-z0-9]+)/u.exec(item.src)?.[1]
    platform.saveFile?.(item.src, /\.\w+$/u.test(item.name) || !extension ? item.name : `${item.name}.${extension}`)
  }
  const open = () => {
    if (!item.src.startsWith("data:")) {
      platform.openExternal(item.src)
      return
    }
    const url = URL.createObjectURL(dataBlob(item.src))
    const tab = platform.blankTab?.() ?? null
    if (tab) tab.location.href = url
    else platform.openExternal(url)
  }
  return {
    copy: platform.copyImage ? copy : undefined,
    save: item.download || platform.saveFile ? save : undefined,
    open,
  }
}

function useBox(viewport: RefObject<HTMLDivElement | null>) {
  const [box, setBox] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const measure = () => setBox({ width: element.clientWidth, height: element.clientHeight })
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [viewport])
  return box
}

function Toolbar(props: { item: Item; count: number; position: number }) {
  const actions = useImageActions(props.item)
  return (
    <div className="absolute inset-x-0 top-0 flex h-14 items-center gap-2 px-4">
      <span aria-hidden className="min-w-0 flex-1 truncate text-sm text-white">
        {props.item.name}
        {props.count > 1 ? (
          <span className="text-white/60 tabular-nums">
            {" "}
            · {props.position + 1} of {props.count}
          </span>
        ) : null}
      </span>
      {actions.copy ? (
        <Button variant="ghost" size="sm" className={iconButton} onClick={actions.copy}>
          <IconCopy /> Copy
        </Button>
      ) : null}
      {actions.save ? (
        <Button variant="ghost" size="sm" className={iconButton} onClick={actions.save}>
          <IconDownload /> Save
        </Button>
      ) : null}
      <Button variant="ghost" size="sm" className={iconButton} onClick={actions.open}>
        <IconExternalLink /> Open
      </Button>
      <DialogClose render={<Button variant="ghost" size="icon-sm" className={iconButton} />}>
        <IconX />
        <span className="sr-only">Close</span>
      </DialogClose>
    </div>
  )
}

function ZoomBar(props: {
  level: number
  onStep: (factor: number) => void
  onFit: () => void
  onFitWidth: () => void
  onActual: () => void
}) {
  return (
    <div className="absolute inset-x-0 bottom-3 flex justify-center">
      <div className="flex items-center gap-1 rounded-xl bg-black/60 p-1 text-white backdrop-blur-sm">
        <Button
          variant="ghost"
          size="icon-sm"
          className={iconButton}
          aria-label="Zoom out"
          onClick={() => props.onStep(1 / ImageZoom.step)}
        >
          <IconMinus />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={cn(iconButton, "min-w-12 tabular-nums")}
          aria-label="Fit to window"
          onClick={props.onFit}
        >
          {props.level}%
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className={iconButton}
          aria-label="Zoom in"
          onClick={() => props.onStep(ImageZoom.step)}
        >
          <IconPlus />
        </Button>
        <Button variant="ghost" size="sm" className={iconButton} onClick={props.onFitWidth}>
          Fit width
        </Button>
        <Button variant="ghost" size="sm" className={iconButton} onClick={props.onActual}>
          Actual size
        </Button>
      </div>
    </div>
  )
}

function Arrows(props: { count: number; position: number; onPrevious: () => void; onNext: () => void }) {
  if (props.count < 2) return null
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className={cn(iconButton, "absolute top-1/2 left-3 -translate-y-1/2")}
        aria-label="Previous image"
        disabled={props.position === 0}
        onClick={props.onPrevious}
      >
        <IconChevronLeft />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn(iconButton, "absolute top-1/2 right-3 -translate-y-1/2")}
        aria-label="Next image"
        disabled={props.position === props.count - 1}
        onClick={props.onNext}
      >
        <IconChevronRight />
      </Button>
    </>
  )
}

function Stage(props: {
  item: Item
  count: number
  position: number
  onPrevious: () => void
  onNext: () => void
  onClose: () => void
}) {
  const actions = useImageActions(props.item)
  const root = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const pointers = useRef(new Map<number, ImageZoom.Point>())
  const swipe = useRef<ImageZoom.Point | undefined>(undefined)
  const [view, setView] = useState(ImageZoom.fit)
  const [natural, setNatural] = useState<{ width: number; height: number }>()
  const [dragging, setDragging] = useState(false)
  const box = useBox(viewport)

  const fitRatio = natural && box.width > 0 ? Math.min(1, box.width / natural.width, box.height / natural.height) : 1
  const fitted = { width: (natural?.width ?? 0) * fitRatio, height: (natural?.height ?? 0) * fitRatio }
  const bounds: ImageZoom.Bounds = {
    width: fitted.width,
    height: fitted.height,
    viewportWidth: box.width,
    viewportHeight: box.height,
    maxScale: ImageZoom.maxScale(fitRatio),
  }
  const zoomed = view.scale > 1.001
  const center = { x: 0, y: 0 }

  useEffect(() => {
    root.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (!image.current || !natural) return
    image.current.style.width = `${fitted.width}px`
    image.current.style.height = `${fitted.height}px`
    image.current.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`
  })

  const anchorOf = (event: { clientX: number; clientY: number }) => {
    const rect = viewport.current?.getBoundingClientRect()
    return rect
      ? { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 }
      : center
  }
  const zoomBy = (factor: number) =>
    setView((current) => ImageZoom.zoomAt(current, current.scale * factor, center, bounds))
  const fitView = () => setView(ImageZoom.fit)
  const fitWidth = () => setView(ImageZoom.zoomAt(ImageZoom.fit, box.width / (fitted.width || 1), center, bounds))
  const actualSize = () => setView(ImageZoom.zoomAt(ImageZoom.fit, 1 / fitRatio, center, bounds))

  const shortcuts: Record<string, () => void> = {
    Escape: zoomed ? fitView : props.onClose,
    ArrowLeft: props.onPrevious,
    ArrowRight: props.onNext,
    "+": () => zoomBy(ImageZoom.step),
    "=": () => zoomBy(ImageZoom.step),
    "-": () => zoomBy(1 / ImageZoom.step),
    "0": fitView,
    "1": actualSize,
    w: fitWidth,
    W: fitWidth,
  }
  const commands: Record<string, (() => void) | undefined> = { c: actions.copy, s: actions.save }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") shortcuts.Escape?.()
    else if (event.metaKey || event.ctrlKey) {
      if (event.key === "c" && window.getSelection()?.toString()) return
      const run = commands[event.key]
      if (!run) return
      event.preventDefault()
      run()
    } else if (!event.altKey) shortcuts[event.key]?.()
  }

  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      const anchor = anchorOf(event)
      setView((current) =>
        ImageZoom.zoomAt(current, current.scale * ImageZoom.wheelFactor(event.deltaY), anchor, bounds),
      )
    } else if (zoomed) {
      event.preventDefault()
      setView((current) => ImageZoom.panBy(current, { x: -event.deltaX, y: -event.deltaY }, bounds))
    }
  }
  const latestWheel = useRef(onWheel)
  useEffect(() => {
    latestWheel.current = onWheel
  })
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const listener = (event: WheelEvent) => latestWheel.current(event)
    element.addEventListener("wheel", listener, { passive: false })
    return () => element.removeEventListener("wheel", listener)
  }, [])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    swipe.current = pointers.current.size === 1 ? { x: event.clientX, y: event.clientY } : undefined
    setDragging(true)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const last = pointers.current.get(event.pointerId)
    if (!last) return
    const next = { x: event.clientX, y: event.clientY }
    const other =
      pointers.current.size === 2 ? [...pointers.current].find(([id]) => id !== event.pointerId)?.[1] : undefined
    if (other) {
      const ratio =
        Math.hypot(next.x - other.x, next.y - other.y) / (Math.hypot(last.x - other.x, last.y - other.y) || 1)
      const anchor = anchorOf({ clientX: (next.x + other.x) / 2, clientY: (next.y + other.y) / 2 })
      setView((current) => ImageZoom.zoomAt(current, current.scale * ratio, anchor, bounds))
    } else if (zoomed) {
      setView((current) => ImageZoom.panBy(current, { x: next.x - last.x, y: next.y - last.y }, bounds))
    }
    pointers.current.set(event.pointerId, next)
  }
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipe.current
    const dx = start ? event.clientX - start.x : 0
    const dy = start ? event.clientY - start.y : 0
    const swiped = event.type === "pointerup" && event.pointerType === "touch" && !zoomed
    if (swiped && Math.abs(dx) > swipeDistance && Math.abs(dx) > 2 * Math.abs(dy)) {
      if (dx < 0) props.onNext()
      else props.onPrevious()
    }
    swipe.current = undefined
    pointers.current.delete(event.pointerId)
    if (pointers.current.size === 0) setDragging(false)
  }

  let cursor = "cursor-zoom-in"
  if (zoomed) cursor = dragging ? "cursor-grabbing" : "cursor-grab"

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions, ren/require-companion-class -- Base UI's popup stops key events before they reach the document, so the viewer listens on a focused wrapper; focus only returns here after an image change
    <div ref={root} tabIndex={-1} className="absolute inset-0 outline-none" onKeyDown={onKeyDown}>
      <div
        ref={viewport}
        className={cn(
          "absolute inset-x-0 top-14 bottom-16 flex touch-none items-center justify-center overflow-hidden select-none",
          cursor,
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onDoubleClick={(event) =>
          setView((current) =>
            current.scale > 1.001
              ? ImageZoom.fit
              : ImageZoom.zoomAt(current, ImageZoom.detailScale(fitRatio), anchorOf(event), bounds),
          )
        }
      >
        <img
          ref={image}
          src={props.item.src}
          alt={props.item.name}
          draggable={false}
          onLoad={(event) =>
            setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
          }
          className={cn(
            "max-h-full max-w-full shrink-0 rounded-sm",
            !dragging && "motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out",
          )}
        />
      </div>
      <ZoomBar
        level={Math.round(view.scale * fitRatio * 100)}
        onStep={zoomBy}
        onFit={fitView}
        onFitWidth={fitWidth}
        onActual={actualSize}
      />
      <Arrows count={props.count} position={props.position} onPrevious={props.onPrevious} onNext={props.onNext} />
      <Toolbar item={props.item} count={props.count} position={props.position} />
    </div>
  )
}

export function ImageViewer(props: {
  items: ReadonlyArray<Item>
  current: string
  onCurrent: (key: string) => void
  onClose: () => void
}) {
  const position = props.items.findIndex((item) => item.key === props.current)
  const item = props.items[position]
  if (!item) return null
  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (details.reason === "escape-key") details.cancel()
        else if (!open) props.onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="top-0 left-0 block h-dvh w-full max-w-none translate-0 gap-0 rounded-none bg-black/95 p-0 text-white sm:max-w-none"
      >
        <DialogTitle className="sr-only">
          {item.name}
          {props.items.length > 1 ? ` · ${position + 1} of ${props.items.length}` : ""}
        </DialogTitle>
        <Stage
          key={item.key}
          item={item}
          count={props.items.length}
          position={position}
          onPrevious={() => {
            const previous = props.items[position - 1]
            if (previous) props.onCurrent(previous.key)
          }}
          onNext={() => {
            const next = props.items[position + 1]
            if (next) props.onCurrent(next.key)
          }}
          onClose={props.onClose}
        />
      </DialogContent>
    </Dialog>
  )
}
