import { cjk } from "@streamdown/cjk"
import { createMathPlugin } from "@streamdown/math"
import { createMermaidPlugin } from "@streamdown/mermaid"
import { createContext, use } from "react"
import type { ComponentProps, ReactNode } from "react"
import { defaultComponents, defaultRemarkPlugins, Streamdown, useIsCodeFenceIncomplete } from "streamdown"
import type { Components, ExtraProps } from "streamdown"
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "../components/code-block.js"
import { AppMention } from "../components/app-mention.js"
import { ImageLightbox } from "../components/image-lightbox.js"
import { useHighlightedCode } from "../hooks/use-highlighted-code.js"

const plugins = {
  cjk,
  math: createMathPlugin({ singleDollarTextMath: true }),
  mermaid: createMermaidPlugin({ config: { fontFamily: "var(--ren-font-sans)" } }),
}
const controls = { table: false }
const linkSafety = { enabled: false }

const sessionPattern = /(?<![\w/.-])(ses_[A-Za-z0-9]{26})(?![\w/-])/g
const sessionExact = /^ses_[A-Za-z0-9]{26}$/
const urlExact = /^https?:\/\/\S+$/
const languagePattern = /language-(\S+)/u

interface MarkdownNode {
  type: string
  value?: string
  children?: Array<MarkdownNode>
  data?: { hName: string; hProperties: Record<string, string> }
}

const skipped = new Set(["link", "linkReference", "inlineCode", "code", "html", "definition"])

const splitSessions = (value: string): Array<MarkdownNode> =>
  value.split(sessionPattern).flatMap((part, index): Array<MarkdownNode> => {
    if (!part) return []
    if (index % 2 === 0) return [{ type: "text", value: part }]
    return [
      {
        type: "sessionLink",
        children: [{ type: "text", value: part }],
        data: { hName: "session-link", hProperties: { session: part } },
      },
    ]
  })

const linkSessions = (node: MarkdownNode) => {
  if (!node.children || skipped.has(node.type)) return
  node.children = node.children.flatMap((child) => {
    if (child.type !== "text" || !child.value) {
      linkSessions(child)
      return [child]
    }
    return splitSessions(child.value)
  })
}

const sessionLinks = () => linkSessions

const remarkPlugins = [...Object.values(defaultRemarkPlugins), sessionLinks]
const allowedTags = { "session-link": ["session"] }

const SessionContext = createContext<((sessionID: string) => void) | undefined>(undefined)

const AppsContext = createContext<ReadonlyArray<AppMention.App>>([])

const DefaultLink = defaultComponents.a

function Anchor(props: ComponentProps<"a"> & ExtraProps) {
  const apps = use(AppsContext)
  const slug = props.href?.startsWith(AppMention.link) ? props.href.slice(AppMention.link.length) : undefined
  const app = slug ? apps.find((item) => item.slug.toLowerCase() === slug) : undefined
  if (app) return <AppMention.Chip app={app} />
  return <DefaultLink {...props} />
}

function SessionButton(props: { session: string; children: ReactNode }) {
  const open = use(SessionContext)
  if (!open) return props.children
  return (
    <button
      type="button"
      data-slot="session-link"
      onClick={() => open(props.session)}
      className="cursor-pointer rounded-sm text-primary underline underline-offset-2 transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {props.children}
    </button>
  )
}

const text = (value: ReactNode) => (typeof value === "string" ? value : undefined)

const DefaultCode = defaultComponents.code

function InlineCode(props: ComponentProps<"code"> & ExtraProps) {
  const value = text(props.children)?.trim() ?? ""
  const content = <DefaultCode {...props} />
  if (sessionExact.test(value)) return <SessionButton session={value}>{content}</SessionButton>
  if (!urlExact.test(value)) return content
  return (
    <a href={value.replaceAll(/[),.;!?]+$/g, "")} target="_blank" rel="noopener noreferrer">
      {content}
    </a>
  )
}

function SessionLink(props: Record<string, unknown> & ExtraProps) {
  const session = typeof props.session === "string" ? props.session : ""
  return <SessionButton session={session}>{session}</SessionButton>
}

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

function BlockCode(props: ComponentProps<"code"> & ExtraProps) {
  const language = languagePattern.exec(props.className ?? "")?.[1] ?? ""
  if (language === "mermaid") return <DefaultCode {...props} />
  return <MarkdownCodeBlock code={text(props.children) ?? ""} language={language} />
}

function Image(props: ComponentProps<"img"> & ExtraProps) {
  if (typeof props.src !== "string" || !props.src) return null
  return (
    <ImageLightbox src={props.src} alt={props.alt ?? ""} className="my-2 block">
      <img src={props.src} alt={props.alt ?? ""} className="max-h-96 max-w-full rounded-md border object-contain" />
    </ImageLightbox>
  )
}

const components: Components = {
  inlineCode: InlineCode,
  code: BlockCode,
  "session-link": SessionLink,
  img: Image,
  a: Anchor,
}

export function MarkdownRenderer(props: {
  content: string
  streaming: boolean
  onOpenSession?: ((sessionID: string) => void) | undefined
  apps?: ReadonlyArray<AppMention.App> | undefined
}) {
  const apps = props.apps ?? []
  return (
    <SessionContext value={props.onOpenSession}>
      <AppsContext value={apps}>
        <Streamdown
          mode={props.streaming ? "streaming" : "static"}
          isAnimating={props.streaming}
          plugins={plugins}
          controls={controls}
          linkSafety={linkSafety}
          tableMaxHeight="32rem"
          remarkPlugins={remarkPlugins}
          allowedTags={allowedTags}
          components={components}
        >
          {AppMention.links(props.content, apps)}
        </Streamdown>
      </AppsContext>
    </SessionContext>
  )
}
