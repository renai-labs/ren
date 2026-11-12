import { createContext, use, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react"
import {
  Streamdown,
  StreamdownContext,
  defaultRehypePlugins,
  defaultUrlTransform,
  extractTableDataFromElement,
  tableDataToCSV,
  tableDataToMarkdown,
  useIsCodeFenceIncomplete,
  type ExtraProps,
  type UrlTransform,
} from "streamdown"
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
import { AppMention, mentionLinks } from "@ren/ui/app-mention"
import { Button } from "@ren/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@ren/ui/dropdown-menu"
import { IconCheck, IconCopy } from "@tabler/icons-react"
import { ImageLightbox } from "./image-lightbox.js"
import type { CatalogApp } from "../lib/apps.js"
import { cn } from "cn"
import { Link } from "@ren/ui/link"

function MarkdownCodeBlock(props: { code: string; language: string }) {
  const incomplete = useIsCodeFenceIncomplete()
  const lines = useHighlightedCode(props.code, props.language)
  return (
    <CodeBlock className="my-3">
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

function MarkdownCode({ node: _node, className, children, ...props }: ComponentProps<"code"> & ExtraProps) {
  if (!("data-block" in props))
    return (
      <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[90%]" {...props}>
        {children}
      </code>
    )
  return (
    <MarkdownCodeBlock
      code={typeof children === "string" ? children : ""}
      language={/language-(\S+)/u.exec(className ?? "")?.[1] ?? ""}
    />
  )
}

function MarkdownImage({ node: _node, src, alt, ...props }: ComponentProps<"img"> & ExtraProps) {
  if (typeof src !== "string" || !src) return null
  return (
    <ImageLightbox src={src} alt={alt ?? ""} className="my-2 block w-fit max-w-full cursor-zoom-in rounded-md">
      <img src={src} alt={alt ?? ""} {...props} className="max-h-96 max-w-full rounded-md border object-contain" />
    </ImageLightbox>
  )
}

type WorkspaceImageRenderer = (path: string, alt: string) => ReactNode
const WorkspaceImages = createContext<WorkspaceImageRenderer | undefined>(undefined)

function MarkdownSpan({ node, children, ...props }: ComponentProps<"span"> & ExtraProps) {
  const render = use(WorkspaceImages)
  const path = node?.properties["data-workspace-image"]
  if (typeof path === "string" && render) return render(path, typeof children === "string" ? children : "")
  return <span {...props}>{children}</span>
}

function MarkdownTable({ node: _node, className, children, ...props }: ComponentProps<"table"> & ExtraProps) {
  const streaming = use(StreamdownContext).isAnimating
  const table = useRef<HTMLTableElement>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timeout = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timeout)
  }, [copied])

  const copy = (format: "markdown" | "csv") => {
    if (!table.current) return
    const data = extractTableDataFromElement(table.current)
    navigator.clipboard
      .writeText(format === "csv" ? tableDataToCSV(data) : tableDataToMarkdown(data))
      .then(() => setCopied(true))
      .catch(() => {})
  }

  return (
    <div
      data-slot="markdown-table"
      className="group/table relative my-3 min-w-0 overflow-hidden rounded-lg border text-sm"
    >
      <section
        data-slot="markdown-table-scroll"
        aria-label="Table"
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the table can overflow, so keyboard users need to reach it to scroll
        tabIndex={0}
        className="scroll-fade-x scrollbar-thin overflow-x-auto overscroll-x-contain outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        {/* oxlint-disable-next-line react/forbid-elements -- the scroll area above must own the fade and the focus, and Table from @ren/ui wraps its own scroll container */}
        <table
          ref={table}
          className={cn(
            "w-full border-collapse tabular-nums [&_td]:px-3 [&_td]:py-2 [&_td]:text-start [&_td]:align-top [&_th]:px-3 [&_th]:py-2 [&_th]:text-start [&_th]:align-top [&_th]:font-medium [&_th]:text-muted-foreground [&_thead]:bg-transparent [&_tr]:border-border [&_tr+tr]:border-t",
            className,
          )}
          {...props}
        >
          {children}
        </table>
      </section>
      {streaming ? null : (
        <div className="absolute inset-e-2 top-2 z-10 opacity-0 transition-opacity group-focus-within/table:opacity-100 group-hover/table:opacity-100 has-[[data-popup-open]]:opacity-100 pointer-coarse:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={copied ? "Copied" : "Copy table"}
                  className="bg-background ring-1 ring-foreground/10"
                />
              }
            >
              {copied ? <IconCheck /> : <IconCopy />}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => copy("markdown")}>Copy as Markdown</DropdownMenuItem>
              <DropdownMenuItem onClick={() => copy("csv")}>Copy as CSV</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  )
}

const components = { code: MarkdownCode, img: MarkdownImage, span: MarkdownSpan, table: MarkdownTable }

interface MarkdownNode {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: MarkdownNode[]
  value?: string
}

const workspaceImages = () => (tree: MarkdownNode) => {
  const visit = (node: MarkdownNode) => {
    const src = node.properties?.src
    if (node.tagName === "img" && typeof src === "string" && /^(?:\.\/)?\.ren\/images\/[^?#]+$/u.test(src)) {
      const path = src.replace(/^\.\//u, "")
      if (!path.split("/").includes("..")) {
        node.tagName = "span"
        node.children = [{ type: "text", value: typeof node.properties?.alt === "string" ? node.properties.alt : "" }]
        node.properties = { "data-workspace-image": path }
      }
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(tree)
}

const appLink = "#ren-app:"

const withDataImages = (schema: unknown) => {
  if (typeof schema !== "object" || schema === null || !("protocols" in schema)) return schema
  const protocols = schema.protocols
  if (typeof protocols !== "object" || protocols === null) return schema
  const src: ReadonlyArray<unknown> = "src" in protocols && Array.isArray(protocols.src) ? protocols.src : []
  return { ...schema, protocols: { ...protocols, src: [...src, "data"] } }
}
const rehypePlugins: Array<(typeof defaultRehypePlugins)[string]> = Object.entries(defaultRehypePlugins).map(
  ([name, plugin]) => (name === "sanitize" && Array.isArray(plugin) ? [plugin[0], withDataImages(plugin[1])] : plugin),
)
const workspaceRehypePlugins = Object.entries(defaultRehypePlugins).flatMap(([name, plugin]) => {
  const safe: (typeof defaultRehypePlugins)[string] =
    name === "sanitize" && Array.isArray(plugin) ? [plugin[0], withDataImages(plugin[1])] : plugin
  return name === "harden" ? [workspaceImages, safe] : [safe]
})

const urlTransform: UrlTransform = (url, key, node) =>
  key === "src" && node.tagName === "img" && url.startsWith("data:image/") ? url : defaultUrlTransform(url, key, node)

const streamAnimation = { animation: "fadeIn", duration: 180, easing: "ease-out", sep: "word" } as const

export function Markdown(props: {
  children: string
  streaming?: boolean | undefined
  className?: string | undefined
  apps?: ReadonlyArray<CatalogApp> | undefined
  workspaceImage?: WorkspaceImageRenderer | undefined
}) {
  const apps = props.apps ?? []
  const withApps =
    apps.length === 0
      ? components
      : {
          ...components,
          a: ({ node: _node, href, children, ...rest }: ComponentProps<"a"> & ExtraProps) => {
            const app = href?.startsWith(appLink)
              ? apps.find((each) => each.slug === href.slice(appLink.length))
              : undefined
            if (app) return <AppMention app={app} />
            return (
              <Link href={href} external className="font-medium underline" {...rest}>
                {children}
              </Link>
            )
          },
        }
  return (
    <WorkspaceImages value={props.workspaceImage}>
      <Streamdown
        controls={false}
        urlTransform={urlTransform}
        rehypePlugins={props.workspaceImage ? workspaceRehypePlugins : rehypePlugins}
        components={withApps}
        isAnimating={props.streaming === true}
        animated={streamAnimation}
        className={cn("min-w-0 text-sm/relaxed", props.className)}
      >
        {mentionLinks(props.children, apps)}
      </Streamdown>
    </WorkspaceImages>
  )
}
