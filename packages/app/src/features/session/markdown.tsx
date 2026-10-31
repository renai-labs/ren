import type { ComponentProps } from "react"
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
import { ImageLightbox } from "../../components/image-lightbox.js"
import type { CatalogApp } from "../../lib/apps.js"
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

const components = { code: MarkdownCode, img: MarkdownImage }

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

const urlTransform: UrlTransform = (url, key, node) =>
  key === "src" && node.tagName === "img" && url.startsWith("data:image/") ? url : defaultUrlTransform(url, key, node)

export function Markdown(props: {
  children: string
  streaming?: boolean | undefined
  className?: string | undefined
  apps?: ReadonlyArray<CatalogApp> | undefined
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
    <Streamdown
      controls={false}
      tableMaxHeight={0}
      urlTransform={urlTransform}
      rehypePlugins={rehypePlugins}
      components={withApps}
      isAnimating={props.streaming === true}
      className={cn("min-w-0 text-sm/relaxed", props.className)}
    >
      {mentionLinks(props.children, apps)}
    </Streamdown>
  )
}
