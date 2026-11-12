import { createContext, use, useState, type ComponentProps, type ReactNode } from "react"
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

function MarkdownImage({ node, src, alt, ...props }: ComponentProps<"img"> & ExtraProps) {
  const [failed, setFailed] = useState<string>()
  if (typeof src !== "string" || !src) return null
  if (failed === src) return <span className="text-muted-foreground">{alt}</span>
  const inline = node?.properties["data-inline"] === true
  const linked = node?.properties["data-linked"] === true
  const image = (className: string) => (
    <img
      src={src}
      alt={alt ?? ""}
      {...props}
      onError={() => setFailed(src)}
      className={cn("h-auto max-h-96 max-w-full object-contain", className)}
    />
  )
  if (inline) return image("inline-block align-middle")
  if (linked) return image("my-2 block rounded-md border")
  return (
    <ImageLightbox src={src} alt={alt ?? ""} className="my-2 block w-fit max-w-full cursor-zoom-in rounded-md">
      {image("rounded-md border")}
    </ImageLightbox>
  )
}

type WorkspaceImageRenderer = (path: string, alt: string, options: { inline: boolean }) => ReactNode
const WorkspaceImages = createContext<WorkspaceImageRenderer | undefined>(undefined)

function MarkdownSpan({ node, children, ...props }: ComponentProps<"span"> & ExtraProps) {
  const render = use(WorkspaceImages)
  const path = node?.properties["data-workspace-image"]
  if (typeof path === "string" && render)
    return render(path, typeof children === "string" ? children : "", {
      inline: node?.properties["data-inline"] === true,
    })
  return <span {...props}>{children}</span>
}

const components = { code: MarkdownCode, img: MarkdownImage, span: MarkdownSpan }

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

const significant = (node: MarkdownNode) =>
  (node.children ?? []).filter((child) => child.type !== "text" || child.value?.trim())

const markImages = () => (tree: MarkdownNode) => {
  const visit = (node: MarkdownNode, context: { inline: boolean; linked: boolean }) => {
    const isLink = node.tagName === "a"
    const isInline = context.inline || ((node.tagName === "p" || isLink) && significant(node).length > 1)
    if (
      node.tagName === "img" ||
      (node.tagName === "span" && node.properties?.["data-workspace-image"] !== undefined)
    ) {
      node.properties = {
        ...node.properties,
        "data-inline": isInline,
        "data-linked": context.linked,
      }
    }
    for (const child of node.children ?? []) visit(child, { inline: isInline, linked: context.linked || isLink })
  }
  visit(tree, { inline: false, linked: false })
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
rehypePlugins.push(markImages)
const workspaceRehypePlugins = Object.entries(defaultRehypePlugins).flatMap(([name, plugin]) => {
  const safe: (typeof defaultRehypePlugins)[string] =
    name === "sanitize" && Array.isArray(plugin) ? [plugin[0], withDataImages(plugin[1])] : plugin
  return name === "harden" ? [workspaceImages, safe] : [safe]
})
workspaceRehypePlugins.push(markImages)

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
        tableMaxHeight={0}
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
