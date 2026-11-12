import { createContext, use, type ComponentProps, type MouseEvent, type ReactNode } from "react"
import GithubSlugger from "github-slugger"
import { IconChevronRight } from "@tabler/icons-react"
import {
  Streamdown,
  defaultRehypePlugins,
  defaultUrlTransform,
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
import { ImageLightbox } from "./image-lightbox.js"
import { scrollToFragment } from "./markdown-fragment-links.js"
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
      <IconChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open/details:rotate-90" />
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

const components = {
  code: MarkdownCode,
  img: MarkdownImage,
  span: MarkdownSpan,
  details: MarkdownDetails,
  summary: MarkdownSummary,
  section: MarkdownSection,
}

export const MarkdownScroll = createContext<((viewport: HTMLElement) => void) | undefined>(undefined)

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

const headingTags = new Set(["h1", "h2", "h3", "h4", "h5", "h6"])

const headingIds = (id: string) => () => (tree: MarkdownNode) => {
  const slugger = new GithubSlugger()
  const visit = (node: MarkdownNode, footnotes: boolean) => {
    const inside = footnotes || node.properties?.["dataFootnotes"] === true || node.properties?.["dataFootnotes"] === ""
    if (node.tagName && headingTags.has(node.tagName) && !inside) {
      const text = (function flatten(each: MarkdownNode): string {
        return each.type === "text" ? (each.value ?? "") : (each.children ?? []).map(flatten).join("")
      })(node)
      node.properties = { ...node.properties, id: `${id}-${slugger.slug(text)}` }
    }
    for (const child of node.children ?? []) visit(child, inside)
  }
  visit(tree, false)
}

const urlTransform: UrlTransform = (url, key, node) =>
  key === "src" && node.tagName === "img" && url.startsWith("data:image/") ? url : defaultUrlTransform(url, key, node)

const streamAnimation = { animation: "fadeIn", duration: 180, easing: "ease-out", sep: "word" } as const

export function Markdown(props: {
  id: string
  children: string
  streaming?: boolean | undefined
  className?: string | undefined
  apps?: ReadonlyArray<CatalogApp> | undefined
  workspaceImage?: WorkspaceImageRenderer | undefined
}) {
  const apps = props.apps ?? []
  const release = use(MarkdownScroll)
  const id = props.id
  const plugins = [...(props.workspaceImage ? workspaceRehypePlugins : rehypePlugins), headingIds(id)]
  const withLinks = {
    ...components,
    a: ({ node: _node, href, children, ...rest }: ComponentProps<"a"> & ExtraProps) => {
      const app = href?.startsWith(appLink) ? apps.find((each) => each.slug === href.slice(appLink.length)) : undefined
      if (app) return <AppMention app={app} />
      if (href?.startsWith("#"))
        return (
          <Link
            href={href}
            {...rest}
            target={undefined}
            rel={undefined}
            className={cn(
              "font-medium underline",
              "data-footnote-ref" in rest && "no-underline before:content-['['] after:content-[']']",
            )}
            onClick={(event: MouseEvent<HTMLAnchorElement>) => {
              event.preventDefault()
              const root = event.currentTarget.closest<HTMLElement>("[data-markdown]")
              if (root) scrollToFragment(root, id, href, release)
            }}
          >
            {children}
          </Link>
        )
      return (
        <Link href={href} external className="font-medium underline" {...rest}>
          {children}
        </Link>
      )
    },
  }
  return (
    <WorkspaceImages value={props.workspaceImage}>
      <div data-markdown={id} className="contents">
        <Streamdown
          controls={false}
          tableMaxHeight={0}
          urlTransform={urlTransform}
          rehypePlugins={plugins}
          remarkRehypeOptions={{ clobberPrefix: `${id}-` }}
          components={withLinks}
          isAnimating={props.streaming === true}
          animated={streamAnimation}
          className={cn("min-w-0 text-sm/relaxed", props.className)}
        >
          {mentionLinks(props.children, apps)}
        </Streamdown>
      </div>
    </WorkspaceImages>
  )
}
