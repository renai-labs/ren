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
import { MediaGallery, useMediaLayout } from "./media-gallery.js"
import { MediaUnavailable } from "./media-unavailable.js"
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
  const layout = useMediaLayout()
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
  if (typeof src !== "string" || !src) return null
  if (failed)
    return (
      <MediaUnavailable
        reason="Couldn't load"
        className={layout.box}
        onRetry={() => {
          setFailed(false)
          setAttempt(attempt + 1)
        }}
      />
    )
  const name = alt || (src.startsWith("data:") ? "" : (src.split(/[?#]/u)[0]?.split("/").at(-1) ?? ""))
  return (
    <ImageLightbox src={src} alt={name} className={layout.trigger}>
      <img key={attempt} src={src} alt={name} onError={() => setFailed(true)} {...props} className={layout.image} />
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

function MarkdownDiv({ node, children, ...props }: ComponentProps<"div"> & ExtraProps) {
  const count = Number(node?.properties["data-media-gallery"])
  if (count > 0) return <MediaGallery count={count}>{children}</MediaGallery>
  return <div {...props}>{children}</div>
}

const components = { code: MarkdownCode, div: MarkdownDiv, img: MarkdownImage, span: MarkdownSpan }

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

const isImage = (node: MarkdownNode) =>
  node.tagName === "img" || (node.tagName === "span" && node.properties?.["data-workspace-image"] !== undefined)

const isBlank = (node: MarkdownNode) => node.type === "text" && !node.value?.trim()

const isGallery = (node: MarkdownNode | undefined) => node?.properties?.["data-media-gallery"] !== undefined

const gallery = (images: ReadonlyArray<MarkdownNode>): MarkdownNode => ({
  type: "element",
  tagName: "div",
  properties: { "data-media-gallery": String(images.length) },
  children: [...images],
})

const splitParagraph = (paragraph: MarkdownNode): MarkdownNode[] => {
  const children = paragraph.children ?? []
  if (!children.some(isImage)) return [paragraph]
  const parts: MarkdownNode[] = []
  let text: MarkdownNode[] = []
  let images: MarkdownNode[] = []
  const flushText = () => {
    if (text.some((node) => !isBlank(node))) parts.push({ ...paragraph, children: text })
    text = []
  }
  const flushImages = () => {
    if (images.length > 0) parts.push(gallery(images))
    images = []
  }
  for (const child of children) {
    if (isImage(child)) {
      flushText()
      images.push(child)
    } else if (!(images.length > 0 && isBlank(child))) {
      flushImages()
      text.push(child)
    }
  }
  flushImages()
  flushText()
  return parts
}

const mediaGallery = () => (tree: MarkdownNode) => {
  const visit = (node: MarkdownNode) => {
    if (node.children) {
      const merged: MarkdownNode[] = []
      for (const child of node.children.flatMap((each) => (each.tagName === "p" ? splitParagraph(each) : [each]))) {
        const last = merged.findLast((each) => !isBlank(each))
        if (isGallery(child) && isGallery(last) && last) {
          last.children = [...(last.children ?? []), ...(child.children ?? [])]
          last.properties = { "data-media-gallery": String(last.children.length) }
        } else if (!(isBlank(child) && merged.length === 0)) {
          merged.push(child)
        }
      }
      node.children = merged
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
rehypePlugins.push(mediaGallery)
const workspaceRehypePlugins = Object.entries(defaultRehypePlugins).flatMap(([name, plugin]) => {
  const safe: (typeof defaultRehypePlugins)[string] =
    name === "sanitize" && Array.isArray(plugin) ? [plugin[0], withDataImages(plugin[1])] : plugin
  return name === "harden" ? [workspaceImages, safe] : [safe]
})
workspaceRehypePlugins.push(mediaGallery)

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
