import { createContext, isValidElement, use, useState, type ComponentProps, type ReactNode } from "react"
import { IconCopy, IconExternalLink, IconLink } from "@tabler/icons-react"
import { Option } from "effect"
import type { ExtraProps } from "streamdown"
import { cn } from "cn"
import { ChatLink } from "@ren/chat/chat-link"
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

export const appLink = "#ren-app:"

export const MarkdownScroll = createContext<((viewport: HTMLElement) => void) | undefined>(undefined)

export const MarkdownContext = createContext<{
  readonly apps: ReadonlyArray<CatalogApp>
  readonly streaming: boolean
  readonly mermaid: boolean
  readonly workspaceImage?: ((path: string, alt: string, options: { inline: boolean }) => ReactNode) | undefined
  readonly fileReference?: ((text: string, code: ReactNode) => ReactNode) | undefined
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

const iconClass = "mr-1 inline-block size-3.5 shrink-0 align-[-2px]"

const brands = [
  { name: "github", hosts: ["github.com"], Mark: GitHubMark },
  { name: "linear", hosts: ["linear.app"], Mark: LinearMark },
  { name: "slack", hosts: ["slack.com"], Mark: SlackMark },
  { name: "notion", hosts: ["notion.so", "notion.site"], Mark: NotionMark },
  { name: "google", hosts: ["docs.google.com", "drive.google.com"], Mark: GoogleMark },
]

function Favicon(props: { host: string }) {
  const platform = Platform.usePlatform()
  const [loaded, setLoaded] = useState(false)
  return (
    <span className={cn(iconClass, "relative")} data-link-icon="favicon" aria-hidden>
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

function LinkIcon(props: { href: string; streaming: boolean }) {
  const platform = Platform.usePlatform()
  if (!URL.canParse(props.href)) return null
  const url = new URL(props.href)
  const host = url.hostname.toLowerCase()
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return <IconWorld className={iconClass} data-link-icon="globe" aria-hidden />
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
  return <Favicon key={host} host={host} />
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
  if (href.startsWith(appLink)) {
    const app = markdown.apps.find((each) => each.slug === href.slice(appLink.length))
    return app ? <AppMention app={app} /> : <span>{children}</span>
  }
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
