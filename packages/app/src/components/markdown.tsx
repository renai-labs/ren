import {
  type ComponentProps,
  type ReactNode,
  use,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import GithubSlugger from "github-slugger"
import remarkBreaks from "remark-breaks"
import {
  Streamdown,
  StreamdownContext,
  defaultComponents,
  defaultRehypePlugins,
  defaultRemarkPlugins,
  defaultUrlTransform,
  extractTableDataFromElement,
  tableDataToCSV,
  tableDataToMarkdown,
  useIsCodeFenceIncomplete,
  type DiagramPlugin,
  type ExtraProps,
  type MermaidErrorComponentProps,
  type UrlTransform,
} from "streamdown"
import { math } from "@streamdown/math"
import {
  IconAlertOctagon,
  IconAlertTriangle,
  IconBulb,
  IconCheck,
  IconChevronRight,
  IconCopy,
  IconDownload,
  IconExternalLink,
  IconInfoCircle,
  IconMaximize,
  IconMessageReport,
  IconMinus,
  IconPlus,
  IconRefresh,
  IconX,
  type Icon,
} from "@tabler/icons-react"
import { cn } from "cn"
import { ChatLink } from "@ren/chat/chat-link"
import { Fences } from "@ren/chat/fences"
import { TexMath } from "@ren/chat/tex-math"
import { Alert, AlertDescription, AlertTitle } from "@ren/ui/alert"
import { mentionLinks } from "@ren/ui/app-mention"
import { Button } from "@ren/ui/button"
import { Checkbox } from "@ren/ui/checkbox"
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
  useHighlightedCode,
} from "@ren/ui/code-block"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import type { CatalogApp } from "../lib/apps.js"
import { useCopy } from "../lib/use-copy.js"
import { ImageThumbnail } from "./image-set.js"
import { markdownClipboard } from "./markdown-clipboard.js"
import { appLink, MarkdownContext, MarkdownLink } from "./markdown-link.js"

export const blockImage = "max-h-96 max-w-full rounded-md border object-contain"
export const inlineImage = "inline-block h-auto max-h-96 max-w-full object-contain align-middle"

let mermaidLoad: Promise<DiagramPlugin | null> | undefined
const loadMermaid = () =>
  (mermaidLoad ??= import("@streamdown/mermaid").then(
    (module) => module.mermaid,
    () => {
      mermaidLoad = undefined
      return null
    },
  ))

const subscribeDark = (notify: () => void) => {
  const observer = new MutationObserver(notify)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
  return () => observer.disconnect()
}
const unsubscribed = () => () => undefined
const isDark = () => document.documentElement.classList.contains("dark")

function MermaidError(props: MermaidErrorComponentProps) {
  return (
    <div className="my-3 flex flex-col gap-2">
      <p className="text-xs text-destructive">{`Diagram error: ${props.error.split("\n")[0]}`}</p>
      <MarkdownCodeBlock code={props.chart} language="mermaid" />
    </div>
  )
}

const mermaidOptions = {
  light: { config: { theme: "default" }, errorComponent: MermaidError },
  dark: { config: { theme: "dark" }, errorComponent: MermaidError },
}

function MarkdownCodeBlock(props: { code: string; language: string }) {
  const incomplete = useIsCodeFenceIncomplete()
  const lines = useHighlightedCode(props.code, props.language)
  return (
    <CodeBlock dir="ltr" className="my-3" data-language={props.language}>
      <CodeBlockHeader>
        <CodeBlockTitle>{props.language || "text"}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={props.code} disabled={incomplete} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent className="max-h-96">
        {lines.map((line, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- a line's position is its identity in highlighted code
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  )
}

const StreamdownCode = defaultComponents.code

function MarkdownCode({ node, className, children, ...props }: ComponentProps<"code"> & ExtraProps) {
  const markdown = use(MarkdownContext)
  const incomplete = useIsCodeFenceIncomplete()
  if ("data-block" in props && markdown.mermaid && !incomplete && /language-mermaid(?:\s|$)/u.test(String(className)))
    return (
      <StreamdownCode node={node} className={className} {...props}>
        {children}
      </StreamdownCode>
    )
  if (!("data-block" in props)) {
    const code = (
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- selecting text is not an action
      <code onDoubleClick={(event) => window.getSelection()?.selectAllChildren(event.currentTarget)} {...props}>
        {children}
      </code>
    )
    return markdown.fileReference && typeof children === "string" ? markdown.fileReference(children, code) : code
  }
  return (
    <MarkdownCodeBlock
      code={typeof children === "string" ? children : ""}
      language={/language-(\S+)/u.exec(className ?? "")?.[1] ?? ""}
    />
  )
}

function PlainImage(props: { src: string; alt: string | undefined }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <span className="text-muted-foreground">{props.alt}</span>
  return <img src={props.src} alt={props.alt ?? ""} onError={() => setFailed(true)} className={inlineImage} />
}

function MarkdownImage({ node, src, alt }: ComponentProps<"img"> & ExtraProps) {
  if (typeof src !== "string" || !src) return null
  if (node?.properties["data-gallery"] !== true) return <PlainImage src={src} alt={alt} />
  const name = alt || (src.startsWith("data:") ? "" : (src.split(/[?#]/u)[0]?.split("/").at(-1) ?? ""))
  return <ImageThumbnail src={src} name={name} className={blockImage} />
}

function MarkdownSpan({ node, children, ...props }: ComponentProps<"span"> & ExtraProps) {
  const render = use(MarkdownContext).workspaceImage
  const path = node?.properties["data-workspace-image"]
  if (typeof path === "string" && render)
    return render(path, typeof children === "string" ? children : "", {
      inline: node?.properties["data-gallery"] !== true,
    })
  return <span {...props}>{children}</span>
}

function MarkdownInput(props: ComponentProps<"input"> & ExtraProps) {
  if (props.type !== "checkbox") return null
  return <Checkbox checked={props.checked === true} readOnly className="mr-2 inline-flex align-text-bottom" />
}

function MarkdownTable({ node: _node, className, children, ...props }: ComponentProps<"table"> & ExtraProps) {
  const streaming = use(StreamdownContext).isAnimating
  const table = useRef<HTMLTableElement>(null)
  const copy = useCopy()
  const copyAs = (format: (data: ReturnType<typeof extractTableDataFromElement>) => string) => {
    if (table.current) copy?.(format(extractTableDataFromElement(table.current)), "Table copied")
  }

  return (
    <div data-slot="markdown-table" className="my-3 min-w-0 text-sm">
      <section
        data-slot="markdown-table-scroll"
        aria-label="Table"
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the table can overflow, so keyboard users need to reach it to scroll
        tabIndex={0}
        className="scroll-fade-x scrollbar-thin overflow-x-auto overscroll-x-contain outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        {/* oxlint-disable-next-line react/forbid-elements -- the scroll area above must own the fade and the focus, and Table from @ren/ui wraps its own scroll container */}
        <table ref={table} className={cn("w-full border-collapse tabular-nums", className)} {...props}>
          {children}
        </table>
      </section>
      {streaming || !copy ? null : (
        <div className="mt-1 flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label="Copy table" className="text-muted-foreground" />
              }
            >
              <IconCopy />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => copyAs(tableDataToMarkdown)}>Copy as Markdown</DropdownMenuItem>
                <DropdownMenuItem onClick={() => copyAs(tableDataToCSV)}>Copy as CSV</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  )
}

const callouts = {
  note: { label: "Note", Icon: IconInfoCircle, tone: "text-chart-1" },
  tip: { label: "Tip", Icon: IconBulb, tone: "text-chart-2" },
  important: { label: "Important", Icon: IconMessageReport, tone: "text-chart-6" },
  warning: { label: "Warning", Icon: IconAlertTriangle, tone: "text-chart-3" },
  caution: { label: "Caution", Icon: IconAlertOctagon, tone: "text-destructive" },
  insight: { label: "Insight", Icon: IconBulb, tone: "text-primary" },
}

function MarkdownBlockquote({ node, children, ...props }: ComponentProps<"blockquote"> & ExtraProps) {
  const kind = "data-callout" in props ? props["data-callout"] : undefined
  const callout = Object.entries(callouts).find(([key]) => key === kind)?.[1]
  if (!callout)
    return (
      <blockquote className="my-4 border-l-4 border-muted-foreground/30 pl-4 text-muted-foreground italic" {...props}>
        {children}
      </blockquote>
    )
  return (
    <Alert
      role="note"
      aria-label={callout.label}
      data-callout={kind}
      className={cn("my-3 rounded-none border-0 bg-transparent p-0", callout.tone)}
    >
      <callout.Icon aria-hidden />
      <AlertTitle>{callout.label}</AlertTitle>
      {node?.children.some((child) => child.type === "element") ? (
        <AlertDescription className="text-foreground">{children}</AlertDescription>
      ) : null}
    </Alert>
  )
}

function MarkdownDetails({ node: _node, className, ...props }: ComponentProps<"details"> & ExtraProps) {
  return (
    <details
      className={cn("group/details my-2 [&>:not(summary)]:mt-1 [&>:not(summary)]:ml-5.5", className)}
      {...props}
    />
  )
}

function MarkdownSummary({ node: _node, className, children, ...props }: ComponentProps<"summary"> & ExtraProps) {
  return (
    <summary
      className={cn(
        "flex cursor-pointer list-none items-center gap-1.5 font-medium select-none marker:content-none [&::-webkit-details-marker]:hidden",
        className,
      )}
      {...props}
    >
      <IconChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-out group-open/details:rotate-90 motion-reduce:transition-none" />
      {children}
    </summary>
  )
}

function MarkdownSection({ node: _node, className, ...props }: ComponentProps<"section"> & ExtraProps) {
  return (
    <section
      className={cn(
        "data-footnotes:mt-4 data-footnotes:border-t data-footnotes:pt-3 data-footnotes:text-[87.5%] data-footnotes:text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

type MarkdownNode = ChatLink.Node

const each = (node: MarkdownNode, visit: (node: MarkdownNode) => void) => {
  visit(node)
  for (const child of node.children ?? []) each(child, visit)
}

const workspaceImages = () => (tree: MarkdownNode) =>
  each(tree, (node) => {
    const src = node.properties?.src
    if (node.tagName !== "img" || typeof src !== "string" || !/^(?:\.\/)?\.ren\/images\/[^?#]+$/u.test(src)) return
    const path = src.replace(/^\.\//u, "")
    if (path.split("/").includes("..")) return
    node.tagName = "span"
    node.children = [{ type: "text", value: typeof node.properties?.alt === "string" ? node.properties.alt : "" }]
    node.properties = { "data-workspace-image": path }
  })

const isImage = (node: MarkdownNode) =>
  node.tagName === "img" || (node.tagName === "span" && node.properties?.["data-workspace-image"] !== undefined)

const isBlank = (node: MarkdownNode) => node.type === "text" && !node.value?.trim()

const mediaGallery = () => (tree: MarkdownNode) =>
  each(tree, (node) => {
    const children = node.children ?? []
    const images = children.filter(isImage)
    if (node.tagName !== "p" || images.length === 0 || !children.every((child) => isImage(child) || isBlank(child)))
      return
    if (images.length > 1 && !children.some((child) => child.value?.includes("\n"))) return
    node.tagName = "div"
    node.properties = { "data-slot": "media-gallery", "data-count": String(images.length) }
    for (const image of images) image.properties = { ...image.properties, "data-gallery": true }
    node.children = images
  })

const imageLine = /^([ \t]*!\[[^\]\n]*\]\([^)\s]+\))[ \t]*\n(?:[ \t]*\n)+(?=[ \t]*!\[[^\]\n]*\]\([^)\s]+\))/gmu

const textOf = (node: MarkdownNode): string =>
  node.type === "text" ? (node.value ?? "") : (node.children ?? []).map(textOf).join("")

const isCode = (node: MarkdownNode | undefined, pattern: RegExp) =>
  node?.tagName === "code" && pattern.test(textOf(node))

const insightOpen = /^★ Insight ─+$/u
const insightClose = /^─+$/u
const calloutMarker = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\r?\n|$)/iu

const firstText = (blockquote: MarkdownNode) => {
  const paragraph = blockquote.children?.find((child) => child.type === "element")
  const text = paragraph?.tagName === "p" ? paragraph.children?.[0] : undefined
  return paragraph && text?.type === "text" ? { paragraph, text } : null
}

const stripMarker = (blockquote: MarkdownNode, first: NonNullable<ReturnType<typeof firstText>>, length: number) => {
  first.text.value = (first.text.value ?? "").slice(length)
  if (first.text.value === "") first.paragraph.children?.shift()
  if (first.paragraph.children?.length === 0 && blockquote.children)
    blockquote.children = blockquote.children.filter((child) => child !== first.paragraph)
}

const calloutKind = (blockquote: MarkdownNode) => {
  const first = firstText(blockquote)
  const marker = calloutMarker.exec(first?.text.value ?? "")
  if (!first || !marker) return null
  if (!marker[0].endsWith("\n") && first.paragraph.children?.length !== 1) return null
  stripMarker(blockquote, first, marker[0].length)
  return marker[1]?.toLowerCase() ?? null
}

const insightBlock = (paragraph: MarkdownNode): MarkdownNode | null => {
  const inline = paragraph.children ?? []
  if (paragraph.tagName !== "p" || inline.length < 3) return null
  if (!isCode(inline[0], insightOpen) || !isCode(inline.at(-1), insightClose)) return null
  const body = inline.slice(1, -1)
  const first = body[0]
  if (first?.type === "text") first.value = (first.value ?? "").replace(/^\r?\n/u, "")
  return {
    type: "element",
    tagName: "blockquote",
    properties: { "data-callout": "insight" },
    children: [{ type: "element", tagName: "p", properties: {}, children: body }],
  }
}

const rehypeCallouts = () => (tree: MarkdownNode) =>
  each(tree, (node) => {
    const kind = node.tagName === "blockquote" ? calloutKind(node) : null
    if (kind) node.properties = { ...node.properties, "data-callout": kind }
    node.children = node.children?.map((child) => insightBlock(child) ?? child)
  })

const chipClosing = /^[.,;:!?)\]}"'’”…]+/u
const chipOpening = /[([{"'‘“]+$/u

const edge = (node: MarkdownNode | undefined, pattern: RegExp) =>
  node?.type === "text" ? (pattern.exec(node.value ?? "")?.[0] ?? "") : ""

const wrapChip = (children: MarkdownNode[], index: number) => {
  const before = children[index - 1]
  const after = children[index + 1]
  const opening = edge(before, chipOpening)
  const closing = edge(after, chipClosing)
  const chip = children[index]
  if (!chip || (!opening && !closing)) return
  if (before && opening) before.value = (before.value ?? "").slice(0, -opening.length)
  if (after && closing) after.value = (after.value ?? "").slice(closing.length)
  children[index] = {
    type: "element",
    tagName: "span",
    properties: { "data-chip": "", className: ["whitespace-nowrap"] },
    children: [{ type: "text", value: opening }, chip, { type: "text", value: closing }],
  }
}

const chipPunctuation = () => (tree: MarkdownNode) =>
  each(tree, (node) => {
    if (node.properties?.["data-chip"] !== undefined) return
    const children = node.children ?? []
    for (const [index, child] of children.entries())
      if (child.tagName === "a" && String(child.properties?.href).startsWith(appLink)) wrapChip(children, index)
  })

const withDataImages = (schema: unknown) => {
  if (typeof schema !== "object" || schema === null || !("protocols" in schema)) return schema
  const protocols = schema.protocols
  if (typeof protocols !== "object" || protocols === null) return schema
  const src: ReadonlyArray<unknown> = "src" in protocols && Array.isArray(protocols.src) ? protocols.src : []
  return { ...schema, protocols: { ...protocols, src: [...src, "data"] } }
}
const chatLinks = () => ChatLink.link
const safePlugins = Object.entries(defaultRehypePlugins).map(([name, plugin]): (typeof defaultRehypePlugins)[string] =>
  name === "sanitize" && Array.isArray(plugin) ? [plugin[0], withDataImages(plugin[1])] : plugin,
)
const pipeline = (first: ReadonlyArray<(typeof defaultRehypePlugins)[string]>) => [
  ...safePlugins.toSpliced(Object.keys(defaultRehypePlugins).indexOf("harden"), 0, ...first, chatLinks),
  mediaGallery,
  rehypeCallouts,
  chipPunctuation,
]
const rehypePlugins = pipeline([])
const workspaceRehypePlugins = pipeline([workspaceImages])
const userRehypePlugins = rehypePlugins.filter((plugin) => plugin !== defaultRehypePlugins.raw)
const remarkPlugins = Object.values(defaultRemarkPlugins)
const userRemarkPlugins = [...remarkPlugins, remarkBreaks]

const headingTags = new Set(["h1", "h2", "h3", "h4", "h5", "h6"])

const headingIds = (id: string) => () => (tree: MarkdownNode) => {
  const slugger = new GithubSlugger()
  const visit = (node: MarkdownNode) => {
    if (node.properties?.["dataFootnotes"] === true || node.properties?.["dataFootnotes"] === "") return
    if (node.tagName && headingTags.has(node.tagName))
      node.properties = { ...node.properties, id: `${id}-${slugger.slug(textOf(node))}` }
    for (const child of node.children ?? []) visit(child)
  }
  visit(tree)
}

const urlTransform: UrlTransform = (url, key, node) =>
  key === "src" && node.tagName === "img" && url.startsWith("data:image/") ? url : defaultUrlTransform(url, key, node)

const components = {
  a: MarkdownLink,
  blockquote: MarkdownBlockquote,
  code: MarkdownCode,
  details: MarkdownDetails,
  img: MarkdownImage,
  input: MarkdownInput,
  section: MarkdownSection,
  span: MarkdownSpan,
  summary: MarkdownSummary,
  table: MarkdownTable,
}

const streamdownIcon = (Icon: Icon) => (props: { size?: number; className?: string | undefined }) => (
  <Icon size={props.size ?? 16} className={props.className} />
)

const streamdownIcons = {
  CheckIcon: streamdownIcon(IconCheck),
  CopyIcon: streamdownIcon(IconCopy),
  DownloadIcon: streamdownIcon(IconDownload),
  ExternalLinkIcon: streamdownIcon(IconExternalLink),
  Maximize2Icon: streamdownIcon(IconMaximize),
  RotateCcwIcon: streamdownIcon(IconRefresh),
  XIcon: streamdownIcon(IconX),
  ZoomInIcon: streamdownIcon(IconPlus),
  ZoomOutIcon: streamdownIcon(IconMinus),
}

const streamAnimation = { animation: "fadeIn", duration: 180, easing: "ease-out", sep: "word" } as const

export function Markdown(props: {
  children: string
  streaming?: boolean | undefined
  source?: "user" | undefined
  className?: string | undefined
  apps?: ReadonlyArray<CatalogApp> | undefined
  workspaceImage?: ((path: string, alt: string, options: { inline: boolean }) => ReactNode) | undefined
  fileReference?: ((text: string, code: ReactNode) => ReactNode) | undefined
}) {
  const id = useId()
  const apps = props.apps ?? []
  const text = TexMath.rewrite(props.children)
  const [mermaid, setMermaid] = useState<DiagramPlugin | null>(null)
  const wantsMermaid = Fences.split(text).some((part) => part.closed && part.info === "mermaid")
  useEffect(() => {
    if (wantsMermaid) void loadMermaid().then(setMermaid)
  }, [wantsMermaid])
  const dark = useSyncExternalStore(wantsMermaid ? subscribeDark : unsubscribed, isDark, () => false)
  const user = props.source === "user"
  const rehype = props.workspaceImage ? workspaceRehypePlugins : rehypePlugins
  return (
    <MarkdownContext
      value={{
        apps,
        streaming: props.streaming === true,
        mermaid: mermaid !== null,
        workspaceImage: props.workspaceImage,
        fileReference: props.fileReference,
      }}
    >
      <div
        data-slot="markdown"
        data-markdown={id}
        data-streaming={props.streaming ? "" : undefined}
        className={cn("min-w-0 text-sm/relaxed", props.className)}
        onCopy={(event) => {
          const selection = window.getSelection()
          const copied =
            selection && selection.rangeCount > 0
              ? markdownClipboard(event.currentTarget, selection.getRangeAt(0))
              : undefined
          if (!copied) return
          event.preventDefault()
          event.clipboardData.setData("text/plain", copied.text)
          event.clipboardData.setData("text/html", copied.html)
        }}
      >
        <Streamdown
          dir="auto"
          controls={{ code: false, table: false, mermaid: true }}
          urlTransform={urlTransform}
          rehypePlugins={[...(user ? userRehypePlugins : rehype), headingIds(id)]}
          remarkPlugins={user ? userRemarkPlugins : remarkPlugins}
          components={components}
          isAnimating={props.streaming === true}
          animated={user ? false : streamAnimation}
          remarkRehypeOptions={{ clobberPrefix: `${id}-` }}
          plugins={{ math, ...(mermaid ? { mermaid } : {}) }}
          mermaid={dark ? mermaidOptions.dark : mermaidOptions.light}
          linkSafety={{ enabled: false }}
          icons={streamdownIcons}
        >
          {Fences.mapProse(mentionLinks(text, apps), (prose) => prose.replace(imageLine, "$1\n"))}
        </Streamdown>
      </div>
    </MarkdownContext>
  )
}
