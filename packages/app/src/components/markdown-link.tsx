import { createContext, use, useState, type ComponentProps, type ComponentType } from "react"
import type { ExtraProps } from "streamdown"
import { AppMention } from "@ren/ui/app-mention"
import { Link } from "@ren/ui/link"
import { cn } from "cn"
import type { CatalogApp } from "../lib/apps.js"
import { GitHubMark, GoogleMark, LinearMark, NotionMark, SlackMark } from "../icons/brands.js"
import { IconWorld } from "../icons/heroicons.js"
import { Logomark } from "../icons/logomark.js"
import { Platform } from "../platform/platform.js"
import { PublicHost } from "@ren/util/public-host"

const appLink = "#ren-app:"

const iconClass = "mr-1 inline-block size-3.5 shrink-0 align-[-2px]"

const brands: ReadonlyArray<{
  readonly name: string
  readonly hosts: ReadonlyArray<string>
  readonly Mark: ComponentType<ComponentProps<"svg">>
}> = [
  { name: "github", hosts: ["github.com"], Mark: GitHubMark },
  { name: "linear", hosts: ["linear.app"], Mark: LinearMark },
  { name: "slack", hosts: ["slack.com"], Mark: SlackMark },
  { name: "notion", hosts: ["notion.so", "notion.site"], Mark: NotionMark },
  { name: "google", hosts: ["docs.google.com", "drive.google.com"], Mark: GoogleMark },
]

export const MarkdownLinks = createContext<{ readonly apps: ReadonlyArray<CatalogApp>; readonly streaming: boolean }>({
  apps: [],
  streaming: false,
})

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

export function MarkdownLink({ node, href, children, ...rest }: ComponentProps<"a"> & ExtraProps) {
  const links = use(MarkdownLinks)
  const app = href?.startsWith(appLink)
    ? links.apps.find((each) => each.slug === href.slice(appLink.length))
    : undefined
  if (app) return <AppMention app={app} />
  const imageLabel = node?.children.some((child) => child.type === "element" && child.tagName === "img") === true
  return (
    <Link href={href} external className="font-medium underline" {...rest}>
      {href && !imageLabel ? <LinkIcon href={href} streaming={links.streaming} /> : null}
      {children}
    </Link>
  )
}
