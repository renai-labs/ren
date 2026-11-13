import { useState } from "react"
import type { SessionMessage } from "@ren/schema/session/message"
import {
  IconAlertTriangle,
  IconArrowsMaximize,
  IconDots,
  IconDownload,
  IconFileCode,
  IconFileOff,
  IconMinus,
  IconPlus,
  IconRefresh,
  IconX,
} from "@tabler/icons-react"
import { useQuery } from "@tanstack/react-query"
import { Alert, AlertAction, AlertTitle } from "@ren/ui/alert"
import { Button } from "@ren/ui/button"
import { Card } from "@ren/ui/card"
import { CodeBlock, CodeBlockContent } from "@ren/ui/code-block"
import { Dialog, DialogContent, DialogTitle } from "@ren/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Skeleton } from "@ren/ui/skeleton"
import { cn } from "cn"
import { errorStatus } from "../../lib/errors.js"
import { useDriveFile } from "../../lib/use-drive-file.js"
import { usePageFrame } from "../../lib/use-page-frame.js"
import { HtmlPageBridge } from "./html-page-bridge.js"

const zoomSteps: ReadonlyArray<number> = [50, 75, 100, 125, 150, 200]

interface Image {
  readonly src: string
  readonly alt: string
}

function PageFrame(props: {
  title: string
  srcdoc: string
  zoom: number
  fill?: boolean | undefined
  onImage: (image: Image) => void
}) {
  const [setFrame, ready] = usePageFrame({ zoom: props.zoom, onImage: props.onImage })
  const [loaded, setLoaded] = useState<string>()
  const [left, setLeft] = useState(false)
  if (left)
    return (
      <Alert className={cn("rounded-none border-0", props.fill && "min-h-0 flex-1")}>
        <IconAlertTriangle />
        <AlertTitle>Blocked: this page tried to open another site</AlertTitle>
      </Alert>
    )
  return (
    <div className={cn("relative bg-background", props.fill && "min-h-0 flex-1")}>
      {ready ? null : <Skeleton className="absolute inset-0 rounded-none" />}
      <iframe
        ref={setFrame}
        title={props.title}
        srcDoc={props.srcdoc}
        sandbox="allow-scripts allow-forms"
        referrerPolicy="no-referrer"
        allow=""
        onLoad={() => (loaded === props.srcdoc ? setLeft(true) : setLoaded(props.srcdoc))}
        className={cn(
          "block w-full border-0 transition-opacity duration-150 ease-out motion-reduce:transition-none",
          props.fill ? "h-full max-h-full" : "h-60 max-h-[70vh] min-h-30",
          ready ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  )
}

function PageHeader(props: {
  title: string
  zoom?: { level: number; onChange: (level: number) => void }
  children: React.ReactNode
}) {
  const zoom = props.zoom
  const index = zoom ? zoomSteps.indexOf(zoom.level) : -1
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{props.title}</span>
      {zoom ? (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            disabled={index <= 0}
            onClick={() => zoom.onChange(zoomSteps[index - 1] ?? zoom.level)}
          >
            <IconMinus />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-12 px-0 tabular-nums"
            aria-label="Reset zoom"
            onClick={() => zoom.onChange(100)}
          >
            {zoom.level}%
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            disabled={index >= zoomSteps.length - 1}
            onClick={() => zoom.onChange(zoomSteps[index + 1] ?? zoom.level)}
          >
            <IconPlus />
          </Button>
        </>
      ) : null}
      {props.children}
    </div>
  )
}

function PageFailure(props: { error: unknown; onRetry: () => void }) {
  const missing = errorStatus(props.error) === 404
  return (
    <Alert variant={missing ? "default" : "destructive"} className="py-2.5">
      {missing ? <IconFileOff /> : <IconAlertTriangle />}
      <AlertTitle>{missing ? "This page is not in the drive" : "Couldn’t load the page"}</AlertTitle>
      <AlertAction className="top-1 right-1">
        <Button variant="ghost" size="sm" onClick={props.onRetry}>
          <IconRefresh data-icon="inline-start" />
          Retry
        </Button>
      </AlertAction>
    </Alert>
  )
}

function PageMenu(props: { source: boolean; onSource: () => void; onDownload: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More" />}>
        <IconDots />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={props.onDownload}>
            <IconDownload />
            Download HTML
          </DropdownMenuItem>
          <DropdownMenuItem onClick={props.onSource}>
            <IconFileCode />
            {props.source ? "Show page" : "Open as source"}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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

function PageBody(props: {
  title: string
  page: { html: string; srcdoc: string }
  source: boolean
  full: boolean
  onFull: (full: boolean) => void
  onImage: (image: Image) => void
}) {
  const [zoom, setZoom] = useState(100)
  return (
    <>
      {props.source ? (
        <CodeBlock size="sm" className="rounded-none">
          <CodeBlockContent wrap className="max-h-[70vh]">
            {props.page.html}
          </CodeBlockContent>
        </CodeBlock>
      ) : (
        <PageFrame title={props.title} srcdoc={props.page.srcdoc} zoom={100} onImage={props.onImage} />
      )}
      <Dialog open={props.full} onOpenChange={props.onFull}>
        <DialogContent
          showCloseButton={false}
          className="inset-4 flex size-auto max-w-none translate-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        >
          <DialogTitle className="sr-only">{props.title}</DialogTitle>
          <PageHeader title={props.title} zoom={{ level: zoom, onChange: setZoom }}>
            <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => props.onFull(false)}>
              <IconX />
            </Button>
          </PageHeader>
          <PageFrame title={props.title} srcdoc={props.page.srcdoc} zoom={zoom} fill onImage={props.onImage} />
        </DialogContent>
      </Dialog>
    </>
  )
}

export function HtmlPage(props: { spaceId: string | undefined; file: SessionMessage.DriveFile }) {
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
        html,
        srcdoc: `<!doctype html>${doc.documentElement.outerHTML}`,
        title: doc.title.trim() || props.file.name,
      }
    },
  })
  const [full, setFull] = useState(false)
  const [source, setSource] = useState(false)
  const [image, setImage] = useState<Image>()
  if (page.isError) return <PageFailure error={page.error} onRetry={() => void page.refetch()} />
  const title = page.data?.title ?? props.file.name
  return (
    <Card size="sm" className="w-full gap-0 rounded-lg py-0">
      <PageHeader title={title}>
        <Button variant="ghost" size="icon-sm" aria-label="Full screen" onClick={() => setFull(true)}>
          <IconArrowsMaximize />
        </Button>
        <PageMenu source={source} onSource={() => setSource(!source)} onDownload={drive.download} />
      </PageHeader>
      {page.data ? (
        <PageBody title={title} page={page.data} source={source} full={full} onFull={setFull} onImage={setImage} />
      ) : (
        <Skeleton className="h-60 rounded-none" />
      )}
      <ImageDialog image={image} onClose={() => setImage(undefined)} />
    </Card>
  )
}
