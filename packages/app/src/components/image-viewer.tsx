import { useEffect, useRef, useState } from "react"
import type { KeyboardEvent } from "react"
import { Button } from "@ren/ui/button"
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@ren/ui/dialog"
import { toast } from "@ren/ui/sonner"
import { IconChevronLeft, IconChevronRight, IconCopy, IconDownload, IconX } from "@tabler/icons-react"
import { cn } from "cn"
import { Platform } from "../platform/platform.js"

export interface Item {
  readonly key: string
  readonly src: string
  readonly name: string
  readonly download?: (() => void) | undefined
}

const iconButton = "text-white hover:bg-white/15 hover:text-white"

function imageActions(item: Item, platform: Platform.Info) {
  const copyImage = platform.copyImage
  const copy = copyImage
    ? () =>
        void copyImage(item.src).then(
          () => toast.success("Image copied"),
          () => toast.error("Couldn't copy the image"),
        )
    : undefined
  const saveFile = platform.saveFile
  const extension = /^data:image\/([a-z0-9]+)/u.exec(item.src)?.[1]
  const save =
    item.download ??
    (saveFile && /^(?:data|blob):/u.test(item.src)
      ? () => saveFile(item.src, /\.\w+$/u.test(item.name) || !extension ? item.name : `${item.name}.${extension}`)
      : undefined)
  return { copy, save }
}

function Picture(props: { item: Item }) {
  const [actualSize, setActualSize] = useState(false)
  return (
    <div className="absolute inset-x-0 top-14 bottom-4 flex overflow-auto overscroll-contain">
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- a click toggles the size; the image is not a control */}
      <img
        src={props.item.src}
        alt={props.item.name}
        onClick={() => setActualSize(!actualSize)}
        className={cn(
          "m-auto shrink-0 rounded-md",
          actualSize ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain",
        )}
      />
    </div>
  )
}

export function ImageViewer(props: {
  items: ReadonlyArray<Item>
  current: string
  onCurrent: (key: string) => void
  onClose: () => void
}) {
  const platform = Platform.usePlatform()
  const root = useRef<HTMLDivElement>(null)
  const position = props.items.findIndex((item) => item.key === props.current)
  const item = props.items[position]
  useEffect(() => {
    root.current?.focus({ preventScroll: true })
  }, [item?.key])
  if (!item) return null
  const count = props.items.length
  const previous = props.items[position - 1]
  const next = props.items[position + 1]
  const actions = imageActions(item, platform)
  const shortcuts = new Map([
    ["ArrowLeft", previous && (() => props.onCurrent(previous.key))],
    ["ArrowRight", next && (() => props.onCurrent(next.key))],
    ["mod+c", actions.copy],
    ["mod+s", actions.save],
  ])
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.metaKey || event.ctrlKey ? `mod+${event.key}` : event.key
    const run = event.altKey ? undefined : shortcuts.get(key)
    if (!run || (key === "mod+c" && window.getSelection()?.toString())) return
    event.preventDefault()
    run()
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="top-0 left-0 block h-dvh w-full max-w-none translate-0 gap-0 rounded-none bg-black/85 p-0 text-white shadow-none backdrop-blur-xl duration-150 sm:max-w-none data-open:zoom-in-100 data-closed:zoom-out-100"
      >
        {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions, ren/require-companion-class -- Base UI's popup stops key events before they reach the document, so the viewer listens on a focused wrapper; focus only returns here after an image change */}
        <div ref={root} tabIndex={-1} className="absolute inset-0 outline-none" onKeyDown={onKeyDown}>
          <Picture key={item.key} item={item} />
          {count > 1 ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className={cn(iconButton, "absolute top-1/2 left-3 -translate-y-1/2")}
                aria-label="Previous image"
                disabled={!previous}
                onClick={() => previous && props.onCurrent(previous.key)}
              >
                <IconChevronLeft />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn(iconButton, "absolute top-1/2 right-3 -translate-y-1/2")}
                aria-label="Next image"
                disabled={!next}
                onClick={() => next && props.onCurrent(next.key)}
              >
                <IconChevronRight />
              </Button>
            </>
          ) : null}
          <div className="absolute inset-x-0 top-0 flex h-14 items-center gap-2 px-4">
            <DialogTitle className="min-w-0 flex-1 truncate text-sm font-normal text-white">
              {item.name}
              {count > 1 ? (
                <span className="text-white/60 tabular-nums">{` · ${position + 1} of ${count}`}</span>
              ) : null}
            </DialogTitle>
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
            <DialogClose render={<Button variant="ghost" size="icon-sm" className={iconButton} />}>
              <IconX />
              <span className="sr-only">Close</span>
            </DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
