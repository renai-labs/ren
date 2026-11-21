import { useRef, useState } from "react"
import type { SessionMessage } from "@ren/schema/session/message"
import { IconArrowsDiagonal, IconDownload, IconMinus, IconPlus, IconX } from "@tabler/icons-react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@ren/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@ren/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { cn } from "cn"
import { errorStatus } from "../../lib/errors.js"
import { useDriveFile } from "../../lib/use-drive-file.js"
import { usePageFrame } from "../../lib/use-page-frame.js"
import { PageHeights } from "../../lib/page-heights.js"
import { Platform } from "../../platform/platform.js"
import { HtmlPageBridge } from "./html-page-bridge.js"

const zoomSteps: ReadonlyArray<number> = [50, 75, 100, 125, 150, 200]

interface Image {
  readonly src: string
  readonly alt: string
}

function PageFrame(props: {
  id: string
  title: string
  srcdoc: string
  zoom: number
  onImage: (image: Image) => void
}) {
  const storage = Platform.usePlatform().storage
  const [setFrame, ready] = usePageFrame({
    zoom: props.zoom,
    onImage: props.onImage,
    onHeight: (height) => PageHeights.set(storage, props.id, height),
  })
  const [loaded, setLoaded] = useState<string>()
  const [left, setLeft] = useState(false)
  if (left)
    return (
      <p className="flex h-20 items-center justify-center text-xs text-muted-foreground">
        Blocked: this page tried to open another site
      </p>
    )
  return (
    <iframe
      ref={setFrame}
      title={props.title}
      srcDoc={props.srcdoc}
      sandbox="allow-scripts allow-forms"
      referrerPolicy="no-referrer"
      allow=""
      onLoad={() => (loaded === props.srcdoc ? setLeft(true) : setLoaded(props.srcdoc))}
      // oxlint-disable-next-line react/forbid-dom-props -- the height this page measured last time, until it measures itself again
      style={{ height: PageHeights.get(storage, props.id) }}
      className={cn(
        "block h-20 min-h-20 w-full border-0 transition-opacity duration-150 ease-out motion-reduce:transition-none",
        ready ? "opacity-100" : "opacity-0",
      )}
    />
  )
}

function FullScreen(props: {
  id: string
  title: string
  srcdoc: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onDownload: () => void
  onImage: (image: Image) => void
}) {
  const [zoom, setZoom] = useState(100)
  const close = useRef<HTMLButtonElement>(null)
  const index = zoomSteps.indexOf(zoom)
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        showCloseButton={false}
        initialFocus={close}
        overlayClassName="bg-black/80 dark:bg-black/80"
        className="w-[min(92vw,--spacing(294))] max-w-none gap-2 bg-transparent p-0 shadow-none sm:max-w-none"
      >
        <DialogTitle className="sr-only">{props.title}</DialogTitle>
        <Button
          ref={close}
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          className="absolute -top-9 right-0 text-white/80 hover:bg-white/10 hover:text-white"
          onClick={() => props.onOpenChange(false)}
        >
          <IconX />
        </Button>
        <div className="max-h-[min(86vh,calc(100vh-(--spacing(40))))] scrollbar-thin overflow-y-auto overscroll-contain rounded-lg bg-background p-4 shadow-dialog">
          <PageFrame
            id={`${props.id}:full`}
            title={props.title}
            srcdoc={props.srcdoc}
            zoom={zoom}
            onImage={props.onImage}
          />
        </div>
        <div className="flex min-w-0 items-center justify-center gap-3 text-xs text-white/80">
          <span className="truncate">{props.title}</span>
          <div className="flex shrink-0 items-center gap-1 [&_button]:text-white/80 [&_button]:hover:bg-white/10 [&_button]:hover:text-white">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Zoom out"
              disabled={index <= 0}
              onClick={() => setZoom(zoomSteps[index - 1] ?? zoom)}
            >
              <IconMinus />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-12 px-0 tabular-nums"
              aria-label="Reset zoom"
              onClick={() => setZoom(100)}
            >
              {zoom}%
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Zoom in"
              disabled={index >= zoomSteps.length - 1}
              onClick={() => setZoom(zoomSteps[index + 1] ?? zoom)}
            >
              <IconPlus />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Download HTML" onClick={props.onDownload}>
              <IconDownload />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ImageDialog(props: { image: Image | undefined; onClose: () => void }) {
  return (
    <Dialog open={props.image !== undefined} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent className="w-fit max-w-[min(92vw,--spacing(300))] gap-2 p-2 sm:max-w-[min(92vw,--spacing(300))]">
        <DialogTitle className="sr-only">{props.image?.alt || "Image"}</DialogTitle>
        <img
          src={props.image?.src}
          alt={props.image?.alt ?? ""}
          className="h-[min(70vh,--spacing(180))] max-h-[85vh] w-auto max-w-full rounded-md object-contain"
        />
      </DialogContent>
    </Dialog>
  )
}

export function HtmlPage(props: { spaceId: string | undefined; file: SessionMessage.DriveFile }) {
  const platform = Platform.usePlatform()
  const drive = useDriveFile(props.spaceId, props.file)
  const page = useQuery({
    // ast-grep-ignore: no-query-key-literal -- reads the page's bytes through its signed drive link, not the API
    queryKey: ["html-page", props.spaceId, props.file.path, props.file.size],
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    queryFn: async (context) => {
      const html = new TextDecoder().decode(await drive.bytes(context.signal))
      const doc = new DOMParser().parseFromString(html, "text/html")
      const meta = doc.createElement("meta")
      meta.httpEquiv = "Content-Security-Policy"
      meta.content = HtmlPageBridge.policy
      const script = doc.createElement("script")
      script.textContent = HtmlPageBridge.script
      doc.head.prepend(meta, script)
      return {
        srcdoc: `<!doctype html>${doc.documentElement.outerHTML}`,
        title: doc.title.trim() || props.file.name,
      }
    },
  })
  const [full, setFull] = useState(false)
  const [image, setImage] = useState<Image>()
  const id = `${props.file.path}:${props.file.size}`
  const title = page.data?.title ?? props.file.name
  if (page.isError)
    return (
      <p className="flex h-20 items-center justify-center gap-1 text-xs text-muted-foreground">
        {errorStatus(page.error) === 404 ? `${title} is not in the drive` : `Unable to load ${title}`}
        <Button variant="ghost" size="sm" onClick={() => void page.refetch()}>
          Retry
        </Button>
      </p>
    )
  return (
    <div className="group/page relative w-full">
      {page.data ? (
        <>
          <PageFrame id={id} title={title} srcdoc={page.data.srcdoc} zoom={100} onImage={setImage} />
          <div className="absolute end-2 top-2 flex gap-1 opacity-0 transition-opacity duration-150 group-hover/page:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="secondary"
                    size="icon-sm"
                    aria-label="Open full screen"
                    className="bg-background/70 shadow-sm backdrop-blur-sm"
                    onClick={() => setFull(true)}
                  />
                }
              >
                <IconArrowsDiagonal />
              </TooltipTrigger>
              <TooltipContent side="left">Open full screen</TooltipContent>
            </Tooltip>
          </div>
          <FullScreen
            id={id}
            title={title}
            srcdoc={page.data.srcdoc}
            open={full}
            onOpenChange={setFull}
            onDownload={drive.download}
            onImage={setImage}
          />
        </>
      ) : (
        // oxlint-disable-next-line react/forbid-dom-props -- keeps the page's last height while its bytes load
        <div className="h-20" style={{ height: PageHeights.get(platform.storage, id) }} />
      )}
      <ImageDialog image={image} onClose={() => setImage(undefined)} />
    </div>
  )
}
