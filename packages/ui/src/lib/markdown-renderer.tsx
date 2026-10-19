import { cjk } from "@streamdown/cjk"
import { code } from "@streamdown/code"
import { createMathPlugin } from "@streamdown/math"
import { createMermaidPlugin } from "@streamdown/mermaid"
import { createContext, use } from "react"
import type { ComponentProps, ReactNode } from "react"
import { defaultComponents, defaultRemarkPlugins, Streamdown } from "streamdown"
import type { Components, ExtraProps } from "streamdown"
import { ImagePreview } from "../components/image-preview.js"

const gradualReveal = { animation: "blurIn", duration: 360, easing: "ease-out", sep: "char", stagger: 0 } as const

const plugins = {
  cjk,
  code,
  math: createMathPlugin({ singleDollarTextMath: true }),
  mermaid: createMermaidPlugin({ config: { fontFamily: "var(--ren-font-sans)" } }),
}
const controls = { table: false }
const linkSafety = { enabled: false }

const sessionPattern = /(?<![\w/.-])(ses_[A-Za-z0-9]{26})(?![\w/-])/g
const sessionExact = /^ses_[A-Za-z0-9]{26}$/
const urlExact = /^https?:\/\/\S+$/

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

function SessionButton(props: { session: string; children: ReactNode }) {
  const open = use(SessionContext)
  if (!open) return props.children
  return (
    <button
      type="button"
      data-slot="session-link"
      onClick={() => open(props.session)}
      className="cursor-pointer text-accent-primary underline underline-offset-2 transition-standard hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent-primary"
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

function Image(props: ComponentProps<"img"> & ExtraProps) {
  if (typeof props.src !== "string" || !props.src) return null
  return <ImagePreview source={props.src} description={props.alt ?? ""} />
}

const components: Components = { inlineCode: InlineCode, "session-link": SessionLink, img: Image }

export function MarkdownRenderer(props: {
  content: string
  source: "static" | "streaming"
  reveal: "none" | "gradual"
  onOpenSession?: ((sessionID: string) => void) | undefined
}) {
  const streaming = props.source === "streaming"
  return (
    <SessionContext value={props.onOpenSession}>
      <Streamdown
        mode={props.source}
        isAnimating={streaming}
        animated={streaming && props.reveal === "gradual" ? gradualReveal : false}
        plugins={plugins}
        controls={controls}
        linkSafety={linkSafety}
        tableMaxHeight="32rem"
        remarkPlugins={remarkPlugins}
        allowedTags={allowedTags}
        components={components}
      >
        {props.content}
      </Streamdown>
    </SessionContext>
  )
}
