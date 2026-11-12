import { useState } from "react"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
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
import { Alert, AlertDescription, AlertTitle } from "@ren/ui/alert"
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
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { Link } from "@ren/ui/link"
import { Skeleton } from "@ren/ui/skeleton"
import { cn } from "cn"
import { errorStatus } from "../../lib/errors.js"
import { usePageFrame } from "../../lib/use-page-frame.js"
import { VisualReplyBridge } from "./visual-reply-bridge.js"

const zoomSteps: ReadonlyArray<number> = [50, 75, 100, 125, 150, 200]

const imagePath = (src: string) => {
  const local = src.replace(/^\.\//u, "")
  const path = local.startsWith("../images/")
    ? `.ren/${local.slice(3)}`
    : /^(?:.*\/)?(\.ren\/images\/[^?#]+)$/u.exec(local)?.at(1)
  return path && !path.split("/").includes("..") ? path : undefined
}

function usePage(root: Session.ID, path: string, version: string) {
  const read = ChatReact.useAction(root, (opened, file: string) => opened.readFile(file))
  return useQuery({
    // ast-grep-ignore: no-query-key-literal -- reads the workspace through the chat session, not the API
    queryKey: ["visual-reply", root, path, version],
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      const file = await read(path)
      if (file.encoding !== "utf8" || file.truncated) throw new Error("Page is too large")
      const doc = new DOMParser().parseFromString(file.content, "text/html")
      const images = [...doc.querySelectorAll("img[src]")].flatMap((image) => {
        const source = imagePath(image.getAttribute("src") ?? "")
        return source ? [{ image, source }] : []
      })
      const loaded = new Map(
        await Promise.all(
          [...new Set(images.map((item) => item.source))].map(async (source) => {
            const found = await read(source).catch(() => undefined)
            const ok = found?.encoding === "base64" && !found.truncated && found.mime.startsWith("image/")
            return [source, ok ? `data:${found.mime};base64,${found.content}` : undefined] as const
          }),
        ),
      )
      for (const item of images) {
        const url = loaded.get(item.source)
        if (url) item.image.setAttribute("src", url)
      }
      const meta = doc.createElement("meta")
      meta.httpEquiv = "Content-Security-Policy"
      meta.content = VisualReplyBridge.policy
      const script = doc.createElement("script")
      script.textContent = VisualReplyBridge.script
      doc.head.prepend(meta, script)
      return {
        html: file.content,
        srcdoc: `<!doctype html>${doc.documentElement.outerHTML}`,
        title: doc.title.trim() || (path.split("/").at(-1) ?? path),
      }
    },
  })
}

function PageFrame(props: {
  title: string
  srcdoc: string
  zoom: number
  fill?: boolean | undefined
  onImage: (image: { src: string; alt: string }) => void
}) {
  const [setFrame, ready] = usePageFrame({ zoom: props.zoom, onImage: props.onImage })
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
        className={cn(
          "block w-full border-0 transition-opacity duration-150 ease-out motion-reduce:transition-none",
          props.fill ? "h-full" : "h-60 max-h-[70vh] min-h-30",
          ready ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  )
}

function PageHeader(props: { title: string; zoom: number; onZoom: (zoom: number) => void; children: React.ReactNode }) {
  const index = zoomSteps.indexOf(props.zoom)
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b bg-muted/50 px-3">
      <span className="min-w-0 flex-1 truncate text-sm">{props.title}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Zoom out"
        disabled={index <= 0}
        onClick={() => props.onZoom(zoomSteps[index - 1] ?? props.zoom)}
      >
        <IconMinus />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="tabular-nums"
        aria-label="Reset zoom"
        onClick={() => props.onZoom(100)}
      >
        {props.zoom}%
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Zoom in"
        disabled={index >= zoomSteps.length - 1}
        onClick={() => props.onZoom(zoomSteps[index + 1] ?? props.zoom)}
      >
        <IconPlus />
      </Button>
      {props.children}
    </div>
  )
}

function PageMenu(props: { name: string; html: string; source: boolean; onSource: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More" />}>
        <IconDots />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem
            render={
              <Link
                appearance="plain"
                href={`data:text/html;charset=utf-8,${encodeURIComponent(props.html)}`}
                download={props.name}
              />
            }
          >
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

function PageFailure(props: { path: string; error: unknown; onRetry: () => void }) {
  if (errorStatus(props.error) === 404)
    return (
      <Empty className="border bg-muted/30 py-6">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconFileOff />
          </EmptyMedia>
          <EmptyTitle>Page not in the workspace</EmptyTitle>
          <EmptyDescription>{props.path}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  return (
    <Alert variant="destructive">
      <IconAlertTriangle />
      <AlertTitle>Couldn’t load the page</AlertTitle>
      <AlertDescription>
        <Button variant="outline" size="sm" onClick={props.onRetry}>
          <IconRefresh data-icon="inline-start" />
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  )
}

function ImageDialog(props: { image: { src: string; alt: string } | undefined; onClose: () => void }) {
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

export function VisualReply(props: { root: Session.ID; path: string; version: string }) {
  const page = usePage(props.root, props.path, props.version)
  const [zoom, setZoom] = useState(100)
  const [full, setFull] = useState(false)
  const [source, setSource] = useState(false)
  const [image, setImage] = useState<{ src: string; alt: string }>()
  const name = props.path.split("/").at(-1) ?? props.path
  if (page.isError) return <PageFailure path={props.path} error={page.error} onRetry={() => void page.refetch()} />
  const data = page.data
  const title = data?.title ?? name
  return (
    <Card size="sm" className="gap-0 rounded-lg py-0">
      <PageHeader title={title} zoom={zoom} onZoom={setZoom}>
        <Button variant="ghost" size="icon-sm" aria-label="Full screen" onClick={() => setFull(true)}>
          <IconArrowsMaximize />
        </Button>
        <PageMenu name={name} html={data?.html ?? ""} source={source} onSource={() => setSource(!source)} />
      </PageHeader>
      {data ? (
        <>
          {source ? (
            <CodeBlock size="sm" className="rounded-none">
              <CodeBlockContent wrap className="max-h-[70vh]">
                {data.html}
              </CodeBlockContent>
            </CodeBlock>
          ) : (
            <PageFrame title={title} srcdoc={data.srcdoc} zoom={zoom} onImage={setImage} />
          )}
          <Dialog open={full} onOpenChange={setFull}>
            <DialogContent
              showCloseButton={false}
              className="inset-4 flex size-auto max-w-none translate-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
            >
              <DialogTitle className="sr-only">{title}</DialogTitle>
              <PageHeader title={title} zoom={zoom} onZoom={setZoom}>
                <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => setFull(false)}>
                  <IconX />
                </Button>
              </PageHeader>
              <PageFrame title={title} srcdoc={data.srcdoc} zoom={zoom} fill onImage={setImage} />
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <Skeleton className="h-60 rounded-none" />
      )}
      <ImageDialog image={image} onClose={() => setImage(undefined)} />
    </Card>
  )
}
