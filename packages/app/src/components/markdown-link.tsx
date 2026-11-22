import { createContext, isValidElement, use, useState, type ComponentProps, type ReactNode } from "react"
import { IconCopy, IconExternalLink, IconLink } from "@tabler/icons-react"
import { Option } from "effect"
import type { ExtraProps } from "streamdown"
import { cn } from "cn"
import { ChatLink } from "@ren/chat/chat-link"
import { Mentions } from "@ren/chat/mentions"
import { AppMention } from "@ren/ui/app-mention"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@ren/ui/context-menu"
import { Link } from "@ren/ui/link"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { PublicHost } from "@ren/util/public-host"
import type { CatalogApp } from "../lib/apps.js"
import { useCopy } from "../lib/use-copy.js"
import { GitHubMark, GoogleMark, LinearMark, NotionMark, SlackMark } from "../icons/brands.js"
import { IconWorld } from "../icons/heroicons.js"
import { Logomark } from "../icons/logomark.js"
import { Platform } from "../platform/platform.js"
import { ChatChip } from "./chat-chip.js"
import { AgentIcon, RepositoryIcon, SkillIcon, TaskIcon } from "./mention-icon.js"

export const appLink = "#ren-app:"

export const mentionLink = "#ren-mention:"

const mentionKinds = { "ren-agent": AgentIcon, agent: AgentIcon, skill: SkillIcon, repository: RepositoryIcon }

const isKind = (kind: string): kind is keyof typeof mentionKinds => Object.hasOwn(mentionKinds, kind)

const linkOf = (item: Mentions.Item, text: string) =>
  `[${item.label.replaceAll(/[[\]\\]/gu, "\\$&")}](${mentionLink}${item.kind}:${encodeURIComponent(text).replaceAll("(", "%28").replaceAll(")", "%29")})`

// oxlint-disable-next-line ren/no-comments -- Shows what the composer sent for each mention as that mention again, outside inline code.
export const sentMentionLinks = (markdown: string, items: ReadonlyArray<Mentions.Item>) =>
  items.length === 0
    ? markdown
    : markdown
        .split(/(`[^`\n]*`)/u)
        .map((part, index) =>
          index % 2 === 1
            ? part
            : Mentions.sentTokens(part, items).reduceRight(
                (text, token) =>
                  text.slice(0, token.start) +
                  linkOf(token.item, part.slice(token.start, token.end)) +
                  text.slice(token.end),
                part,
              ),
        )
        .join("")

export const MarkdownScroll = createContext<((viewport: HTMLElement) => void) | undefined>(undefined)

export const MarkdownContext = createContext<{
  readonly apps: ReadonlyArray<CatalogApp>
  readonly streaming: boolean
  readonly mermaid: boolean
  readonly workspaceImage?: ((path: string, alt: string, options: { inline: boolean }) => ReactNode) | undefined
  readonly fileReference?: ((text: string, code: ReactNode) => ReactNode) | undefined
  readonly driveFile?: ((path: string, text: ReactNode, options: { image: boolean }) => ReactNode) | undefined
}>({ apps: [], streaming: false, mermaid: false })

const labelText = (node: ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(labelText).join("")
  if (isValidElement<{ children?: ReactNode }>(node)) return labelText(node.props.children)
  return ""
}

const wrapClass = (label: string) => {
  if (/\s/u.test(label.trim())) return ""
  return label.length <= 24 && !/^(?:https?:\/\/|www\.)/iu.test(label) ? "whitespace-nowrap" : "break-all"
}

const inlineIcon = "mr-1 inline-block size-3.5 shrink-0 align-[-2px]"

const brands = [
  { name: "github", hosts: ["github.com"], Mark: GitHubMark },
  { name: "linear", hosts: ["linear.app"], Mark: LinearMark },
  { name: "slack", hosts: ["slack.com"], Mark: SlackMark },
  { name: "notion", hosts: ["notion.so", "notion.site"], Mark: NotionMark },
  { name: "google", hosts: ["docs.google.com", "drive.google.com"], Mark: GoogleMark },
]

function Favicon(props: { host: string; className: string }) {
  const platform = Platform.usePlatform()
  const [loaded, setLoaded] = useState(false)
  return (
    <span className={cn(props.className, "relative")} data-link-icon="favicon" aria-hidden>
      <IconWorld className={cn("size-3.5", loaded && "invisible")} data-link-icon="globe" />
      <img
        ref={(image) => {
          if (image?.complete && image.naturalWidth > 0) setLoaded(true)
        }}
        src={`${platform.serverUrl}/favicons/${encodeURIComponent(props.host)}`}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
        className={cn("absolute inset-0 size-3.5 rounded-sm", !loaded && "opacity-0")}
      />
    </span>
  )
}

export function LinkIcon(props: { href: string; streaming: boolean; className?: string | undefined }) {
  const platform = Platform.usePlatform()
  const iconClass = props.className ?? inlineIcon
  if (!URL.canParse(props.href)) return null
  const url = new URL(props.href)
  const host = url.hostname.toLowerCase()
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return <IconWorld className={iconClass} data-link-icon="globe" aria-hidden />
  if (url.origin === new URL(platform.appUrl).origin && /^\/tasks\/[^/]+$/u.test(url.pathname))
    return <TaskIcon className={iconClass} data-link-icon="task" aria-hidden />
  if (url.origin === new URL(platform.appUrl).origin)
    return (
      <span data-link-icon="ren" className="contents">
        <Logomark className={iconClass} />
      </span>
    )
  const brand = brands.find((each) => each.hosts.some((name) => host === name || host.endsWith(`.${name}`)))
  if (brand) return <brand.Mark className={iconClass} data-link-icon={brand.name} />
  if (props.streaming || !PublicHost.isPublic(host))
    return <IconWorld className={iconClass} data-link-icon="globe" aria-hidden />
  return <Favicon key={host} host={host} className={iconClass} />
}

const mentionOf = (href: string, apps: ReadonlyArray<CatalogApp>, label: ReactNode) => {
  if (href.startsWith(mentionLink)) {
    const rest = href.slice(mentionLink.length)
    const kind = rest.slice(0, rest.indexOf(":"))
    const Icon = isKind(kind) ? mentionKinds[kind] : AgentIcon
    return (
      <span
        data-mention-text={Option.getOrElse(Option.liftThrowable(decodeURIComponent)(rest.slice(kind.length + 1)), () =>
          rest.slice(kind.length + 1),
        )}
        className="font-semibold whitespace-nowrap text-link"
      >
        <Icon aria-hidden className={inlineIcon} />
        {label}
      </span>
    )
  }
  if (!href.startsWith(appLink)) return null
  const app = apps.find((each) => each.slug === href.slice(appLink.length))
  return app ? <AppMention app={app} /> : <span>{label}</span>
}

export function MarkdownLink({ node, href, className, children, onClick, ...rest }: ComponentProps<"a"> & ExtraProps) {
  const platform = Platform.usePlatform()
  const markdown = use(MarkdownContext)
  const release = use(MarkdownScroll)
  const copy = useCopy()
  const [menuOpen, setMenuOpen] = useState(false)
  const [tipOpen, setTipOpen] = useState(false)
  if (!href) return <span>{children}</span>
  const chat = ChatLink.parse(href, platform.appUrl)
  if (chat)
    return (
      <ChatChip
        id={chat.id}
        child={chat.child}
        href={href.startsWith(ChatLink.hash) ? undefined : href}
        label={children}
      />
    )
  const mention = mentionOf(href, markdown.apps, children)
  if (mention) return mention
  if (href.startsWith("#"))
    return (
      <Link
        appearance="content"
        href={href}
        {...rest}
        target={undefined}
        rel={undefined}
        className={cn("data-footnote-ref" in rest && "no-underline before:content-['['] after:content-[']']")}
        onClick={(event) => {
          event.preventDefault()
          const root = event.currentTarget.closest<HTMLElement>("[data-markdown]")
          const fragment = Option.getOrElse(Option.liftThrowable(decodeURIComponent)(href.slice(1)), () =>
            href.slice(1),
          )
          const target = [fragment, `${root?.dataset.markdown}-${fragment.toLowerCase()}`]
            .map((id) => root?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`))
            .find((element) => element)
          let scroller = root?.parentElement
          while (scroller && !/auto|scroll/u.test(getComputedStyle(scroller).overflowY))
            scroller = scroller.parentElement
          if (!fragment || !target || !scroller) return
          release?.(scroller)
          // ast-grep-ignore: no-manual-scroll -- a link jumps to its target in the transcript, which MessageScroller has no API for
          scroller.scrollTo({
            top: scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
          })
        }}
      >
        {children}
      </Link>
    )
  const label = labelText(children)
  return (
    <ContextMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <Tooltip open={tipOpen && !menuOpen} onOpenChange={setTipOpen}>
        <TooltipTrigger
          render={
            <ContextMenuTrigger
              render={
                <Link
                  appearance="content"
                  href={href}
                  external
                  onClick={(event) => {
                    onClick?.(event)
                    if (event.defaultPrevented || !/^https?:/iu.test(href)) return
                    event.preventDefault()
                    platform.openExternal(href)
                  }}
                  className={cn(wrapClass(label), className)}
                  {...rest}
                />
              }
              onContextMenu={(event) => {
                if (event.button !== 2 || !event.shiftKey) return
                event.nativeEvent.stopPropagation()
                event.preventBaseUIHandler()
              }}
            />
          }
        >
          {node?.children.some((child) => child.type === "element" && child.tagName === "img") ? null : (
            <LinkIcon href={href} streaming={markdown.streaming} />
          )}
          {children}
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={10} className="max-w-90 break-all">
          {href}
        </TooltipContent>
      </Tooltip>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => platform.openExternal(href)}>
          <IconExternalLink />
          Open link
        </ContextMenuItem>
        {copy ? (
          <>
            <ContextMenuItem onClick={() => copy(href, "Link copied")}>
              <IconLink />
              Copy link
            </ContextMenuItem>
            <ContextMenuItem onClick={() => copy(label, "Link text copied")}>
              <IconCopy />
              Copy link text
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  )
}
