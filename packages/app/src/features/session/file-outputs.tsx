import { use, useEffect, useRef, useState } from "react"
import type { SessionMessage } from "@ren/schema/session/message"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { IconArrowUpRight, IconDownload } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { FileIcon } from "@ren/ui/file-icon"
import { cn } from "cn"
import { DriveFilePreview } from "../../components/file-preview/drive-file-view.js"
import { useNear } from "../../components/file-preview/page-field.js"
import { parseCsv } from "../../components/file-preview/xlsx.js"
import { Markdown } from "../../components/markdown.js"
import { MediaPlayer } from "../../components/media-player.js"
import { HtmlPage } from "./html-page.js"
import { formatBytes, plural } from "../../lib/format.js"
import { PageHeights } from "../../lib/page-heights.js"
import { playableKind, useDriveFile } from "../../lib/use-drive-file.js"
import { Platform } from "../../platform/platform.js"
import { HtmlPageBridge } from "./html-page-bridge.js"
import { OpenPanel } from "./open-panel.js"

type Kind =
  | "image"
  | "page"
  | "video"
  | "audio"
  | "table"
  | "sheet"
  | "pdf"
  | "markdown"
  | "code"
  | "text"
  | "document"
  | "slides"
  | "archive"
  | "other"

const languages: Readonly<Record<string, string>> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  py: "Python",
  rb: "Ruby",
  go: "Go",
  rs: "Rust",
  java: "Java",
  kt: "Kotlin",
  swift: "Swift",
  c: "C",
  h: "C",
  cpp: "C++",
  cs: "C#",
  php: "PHP",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  sql: "SQL",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  json: "JSON",
  xml: "XML",
  css: "CSS",
  scss: "SCSS",
  html: "HTML",
}

const extensionOf = (name: string) => (name.includes(".") ? (name.split(".").at(-1) ?? "").toLowerCase() : "")

const extensions: ReadonlyArray<readonly [Kind, ReadonlyArray<string>]> = [
  ["table", ["csv", "tsv"]],
  ["sheet", ["xlsx", "xls", "ods", "numbers"]],
  ["markdown", ["md", "markdown", "mdx"]],
  ["document", ["docx", "doc", "odt", "rtf", "pages"]],
  ["slides", ["pptx", "ppt", "odp", "key"]],
  ["archive", ["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar"]],
  ["text", ["txt", "log", "ini", "env", "conf", "cfg"]],
  ["pdf", ["pdf"]],
]

const kindOf = (file: SessionMessage.DriveFile): Kind => {
  const mime = file.mime
  const extension = extensionOf(file.name)
  if (mime.startsWith("image/")) return "image"
  if (mime === "text/html" || extension === "html" || extension === "htm")
    return file.size <= HtmlPageBridge.maxPageBytes ? "page" : "code"
  const playable = playableKind(mime)
  if (playable) return playable
  if (mime === "application/pdf") return "pdf"
  const known = extensions.find((entry) => entry[1].includes(extension))?.[0]
  if (known) return known
  if (languages[extension]) return "code"
  return mime.startsWith("text/") ? "text" : "other"
}

const labels: Readonly<Record<Kind, string>> = {
  image: "Image",
  page: "Web page",
  video: "Video",
  audio: "Audio",
  table: "Table",
  sheet: "Spreadsheet",
  pdf: "PDF",
  markdown: "Markdown",
  code: "Code",
  text: "Text",
  document: "Document",
  slides: "Slides",
  archive: "Archive",
  other: "File",
}

const labelOf = (file: SessionMessage.DriveFile) => {
  const kind = kindOf(file)
  if (kind === "code") return languages[extensionOf(file.name)] ?? labels.code
  if (kind === "table") return extensionOf(file.name).toUpperCase() || labels.table
  return labels[kind]
}

const metaOf = (file: SessionMessage.DriveFile) => `${labelOf(file)} · ${formatBytes(file.size)}`

const textBytes = 64 * 1024

function useFileText(spaceId: string | undefined, file: SessionMessage.DriveFile) {
  const drive = useDriveFile(spaceId, file)
  return useQuery({
    // ast-grep-ignore: no-query-key-literal -- reads the file's bytes through its signed drive link, not the API
    queryKey: ["file-output-text", spaceId, file.path, file.size],
    enabled: Boolean(spaceId),
    staleTime: Infinity,
    retry: false,
    queryFn: async (context) => new TextDecoder().decode(await drive.bytes(context.signal, textBytes)),
  })
}

// oxlint-disable-next-line ren/no-comments -- A file opens in the Files tab of the workspace panel; only a view without the panel, such as a subagent's own thread, falls back to the preview window.
function useOpen(spaceId: string | undefined, file: SessionMessage.DriveFile) {
  const navigate = useNavigate()
  const panel = use(OpenPanel)
  const [open, setOpen] = useState(false)
  if (panel) return { open: () => panel({ kind: "files", path: file.path, drive: { spaceId, file } }), dialog: null }
  return {
    open: () => setOpen(true),
    dialog: (
      <DriveFilePreview
        space={spaceId}
        file={file}
        open={open}
        onOpenChange={setOpen}
        onFolder={(folder) => void navigate({ to: "/drive", search: { space: spaceId, folder } })}
      />
    ),
  }
}

function TypeIcon(props: { file: SessionMessage.DriveFile; className?: string | undefined }) {
  return <FileIcon name={props.file.name} mime={props.file.mime} className={cn("size-5", props.className)} />
}

// oxlint-disable-next-line ren/no-comments -- The actions are hidden until the pointer is over the card or focus is inside it. On touch screens they always show.
function Actions(props: { onOpen?: (() => void) | undefined; onDownload: () => void; name: string }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-0.5 transition-opacity duration-150 ease-out motion-reduce:transition-none pointer-coarse:opacity-100",
        "opacity-0 group-hover/output:opacity-100 group-focus-within/output:opacity-100",
      )}
    >
      {props.onOpen ? (
        <Button variant="ghost" size="icon-sm" aria-label={`Open ${props.name}`} onClick={props.onOpen}>
          <IconArrowUpRight />
        </Button>
      ) : null}
      <Button variant="ghost" size="icon-sm" aria-label={`Download ${props.name}`} onClick={props.onDownload}>
        <IconDownload />
      </Button>
    </span>
  )
}

const sizeKey = (file: SessionMessage.DriveFile, side: "w" | "h") => `${side}:${file.path}:${file.size}`

const imageMaxHeight = 360

// oxlint-disable-next-line ren/no-comments -- An image shows at its natural size, at most 360px tall. Its size from the last load reserves the space while it loads again.
function OutputImage(props: {
  spaceId: string | undefined
  file: SessionMessage.DriveFile
  onOpen: () => void
  className?: string | undefined
}) {
  const storage = Platform.usePlatform().storage
  const drive = useDriveFile(props.spaceId, props.file)
  const width = PageHeights.get(storage, sizeKey(props.file, "w"))
  const height = PageHeights.get(storage, sizeKey(props.file, "h"))
  const [loaded, setLoaded] = useState(false)
  const known = width !== undefined && height !== undefined && height > 0
  return (
    <div
      // oxlint-disable-next-line react/forbid-dom-props -- the image's own size, remembered from the last time it loaded
      style={
        known
          ? {
              aspectRatio: `${width} / ${height}`,
              width: `min(100%, ${width}px, ${(imageMaxHeight * width) / height}px)`,
            }
          : { aspectRatio: "4 / 3", width: "min(100%, 320px)" }
      }
      className={cn("relative overflow-hidden rounded-xl bg-muted", props.className)}
    >
      {drive.url ? (
        <button
          type="button"
          aria-label={`Open ${props.file.name}`}
          onClick={props.onOpen}
          className="block size-full cursor-pointer outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <img
            src={drive.url}
            alt={props.file.name}
            onLoad={(event) => {
              const image = event.currentTarget
              if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                PageHeights.set(storage, sizeKey(props.file, "w"), image.naturalWidth)
                PageHeights.set(storage, sizeKey(props.file, "h"), image.naturalHeight)
              }
              setLoaded(true)
            }}
            onError={drive.reload}
            className={cn(
              "size-full object-contain transition-opacity duration-200 ease-out motion-reduce:transition-none",
              loaded ? "opacity-100" : "opacity-0",
            )}
          />
        </button>
      ) : null}
    </div>
  )
}

// oxlint-disable-next-line ren/no-comments -- The first page of a PDF, fetched and drawn once its card nears the view, so a long chat does not load every PDF it ever showed.
function PdfFirstPage(props: { spaceId: string | undefined; file: SessionMessage.DriveFile; width: number }) {
  const drive = useDriveFile(props.spaceId, props.file)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [pages, setPages] = useState<number>()
  const [near, setNear] = useState(false)
  useNear(canvas, () => setNear(true))
  const bytes = useQuery({
    // ast-grep-ignore: no-query-key-literal -- reads the file's bytes through its signed drive link, not the API
    queryKey: ["file-output-pdf", props.spaceId, props.file.path, props.file.size],
    enabled: near && Boolean(props.spaceId),
    staleTime: Infinity,
    retry: false,
    queryFn: (context) => drive.bytes(context.signal),
  })
  const data = bytes.data
  useEffect(() => {
    const target = canvas.current
    if (!data || !target) return
    const cancelled = { value: false }
    const destroy: { current: (() => void) | undefined } = { current: undefined }
    void import("pdfjs-dist")
      .then(async (pdfjs) => {
        if (cancelled.value) return
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).href
        const assets = `${import.meta.env.BASE_URL}pdfjs/`
        const task = pdfjs.getDocument({
          data: new Uint8Array(data.slice(0)),
          cMapUrl: `${assets}cmaps/`,
          standardFontDataUrl: `${assets}standard_fonts/`,
          wasmUrl: `${assets}wasm/`,
        })
        destroy.current = () => void task.destroy()
        const doc = await task.promise
        if (cancelled.value) return
        setPages(doc.numPages)
        const page = await doc.getPage(1)
        const base = page.getViewport({ scale: 1 })
        const scale = (props.width / base.width) * window.devicePixelRatio
        const viewport = page.getViewport({ scale })
        target.width = viewport.width
        target.height = viewport.height
        target.style.aspectRatio = `${base.width} / ${base.height}`
        await page.render({ canvas: target, viewport }).promise
      })
      .catch((error: unknown) => {
        if (!cancelled.value) throw error
      })
    return () => {
      cancelled.value = true
      destroy.current?.()
    }
  }, [data, props.width])
  return (
    <div className="flex flex-col gap-1.5">
      <canvas
        ref={canvas}
        // oxlint-disable-next-line react/forbid-dom-props -- a letter page until the PDF says its own size
        style={{ width: props.width, aspectRatio: "8.5 / 11" }}
        className="rounded-md bg-white shadow-sm ring-1 ring-black/10"
      />
      {pages ? (
        <span className="text-xs text-muted-foreground tabular-nums">{pages === 1 ? "1 page" : `${pages} pages`}</span>
      ) : null}
    </div>
  )
}

const arrive = "animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none"

const previewRows = 6
const previewLines = 14

function TablePreview(props: { spaceId: string | undefined; file: SessionMessage.DriveFile }) {
  const text = useFileText(props.spaceId, props.file)
  if (!text.data) return <div className="h-40 animate-pulse bg-muted/30" />
  const whole = props.file.size <= textBytes
  const rows = parseCsv(text.data).rows.slice(0, whole ? undefined : -1)
  const header = rows[0] ?? []
  const body = rows.slice(1, previewRows + 1)
  const more = rows.length - 1 - body.length
  return (
    <div className="flex flex-col">
      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="border-b bg-muted/30 text-left text-muted-foreground">
              {header.map((cell, index) => (
                <th key={index} className="px-3 py-1.5 font-medium whitespace-nowrap">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, index) => (
              <tr key={index} className="border-b last:border-b-0">
                {row.map((cell, column) => (
                  <td key={column} className="max-w-60 truncate px-3 py-1.5 whitespace-nowrap">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more > 0 || !whole ? (
        <span className="border-t px-3 py-1.5 text-xs text-muted-foreground tabular-nums">
          {whole ? plural(more, "more row", "more rows") : "More rows"}
        </span>
      ) : null}
    </div>
  )
}

function TextPreview(props: { spaceId: string | undefined; file: SessionMessage.DriveFile; kind: Kind }) {
  const text = useFileText(props.spaceId, props.file)
  if (!text.data) return <div className="h-40 animate-pulse bg-muted/30" />
  const lines = text.data.split("\n")
  const head = lines.slice(0, previewLines).join("\n")
  const cut = lines.length > previewLines
  return (
    <div className={cn("relative max-h-64 overflow-hidden", cut && "mask-b-from-60% mask-b-to-100%")}>
      {props.kind === "markdown" ? (
        <Markdown className="px-4 py-3 text-sm">{text.data.slice(0, 2400)}</Markdown>
      ) : props.kind === "code" ? (
        <Markdown className="text-xs [&_[data-slot=code-block]]:m-0 [&_[data-slot=code-block]]:rounded-none [&_[data-slot=code-block]]:border-0 [&_[data-slot=code-block-footer]]:hidden [&_[data-slot=code-block-header]]:hidden">
          {`\`\`\`${extensionOf(props.file.name)}\n${head}\n\`\`\``}
        </Markdown>
      ) : (
        <pre className="px-4 py-3 font-mono text-xs leading-5 whitespace-pre-wrap text-muted-foreground">{head}</pre>
      )}
    </div>
  )
}

const bodyKinds: ReadonlyArray<Kind> = ["image", "page", "video", "audio", "table", "markdown", "code", "text", "pdf"]

function PreviewBody(props: { spaceId: string | undefined; file: SessionMessage.DriveFile; onOpen: () => void }) {
  const kind = kindOf(props.file)
  if (kind === "image")
    return (
      <div className="flex justify-center p-2">
        <OutputImage spaceId={props.spaceId} file={props.file} onOpen={props.onOpen} />
      </div>
    )
  if (kind === "video" || kind === "audio")
    return (
      <div className="p-2">
        <MediaPlayer spaceId={props.spaceId} file={props.file} kind={kind} />
      </div>
    )
  if (kind === "table") return <TablePreview spaceId={props.spaceId} file={props.file} />
  if (kind === "pdf")
    return (
      <div className="flex justify-center bg-muted/20 p-4">
        <PdfFirstPage spaceId={props.spaceId} file={props.file} width={200} />
      </div>
    )
  return <TextPreview spaceId={props.spaceId} file={props.file} kind={kind} />
}

function PreviewCard(props: { spaceId: string | undefined; file: SessionMessage.DriveFile; fresh: boolean }) {
  const drive = useDriveFile(props.spaceId, props.file)
  const open = useOpen(props.spaceId, props.file)
  const kind = kindOf(props.file)
  const body = !drive.deleted && bodyKinds.includes(kind)
  const opens = !drive.deleted
  // oxlint-disable-next-line ren/no-comments -- A page the agent made is its answer: it shows as itself in the chat, with no card around it.
  if (kind === "page")
    return (
      <div className={cn(props.fresh && arrive)}>
        <HtmlPage spaceId={props.spaceId} file={props.file} />
      </div>
    )
  return (
    <div className={cn("group/output overflow-hidden rounded-xl border bg-card", props.fresh && arrive)}>
      <div className={cn("relative flex items-center gap-2.5 py-2 pr-2 pl-2.5", body && "border-b")}>
        {opens ? (
          <button
            type="button"
            aria-label={`Open ${props.file.name}`}
            onClick={open.open}
            className="absolute inset-0 outline-none transition-colors duration-150 ease-out hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
          />
        ) : null}
        <TypeIcon file={props.file} className="ml-1" />
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate text-sm font-medium">{props.file.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {drive.deleted ? "Not in the drive" : metaOf(props.file)}
          </span>
        </span>
        {drive.deleted ? null : (
          <span className="relative z-10">
            <Actions name={props.file.name} onOpen={opens ? open.open : undefined} onDownload={drive.download} />
          </span>
        )}
      </div>
      {body ? <PreviewBody spaceId={props.spaceId} file={props.file} onOpen={open.open} /> : null}
      {open.dialog}
    </div>
  )
}

// oxlint-disable-next-line ren/no-comments -- The files a turn showed, one card each with a preview of its content. A page the agent made shows as itself. A file that arrives while the chat is open slides in, and a file that was there when the chat opened does not.
export function FileOutputs(props: { spaceId: string | undefined; files: ReadonlyArray<SessionMessage.DriveFile> }) {
  const [opened] = useState(() => new Set(props.files.map((file) => file.path)))
  return (
    <div className="flex flex-col gap-3">
      {props.files.map((file) => (
        <PreviewCard key={file.path} spaceId={props.spaceId} file={file} fresh={!opened.has(file.path)} />
      ))}
    </div>
  )
}
