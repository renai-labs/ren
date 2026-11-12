import { createContext, use, type ComponentProps, type MouseEvent } from "react"
import type { ExtraProps } from "streamdown"
import { AppMention } from "@ren/ui/app-mention"
import { Link } from "@ren/ui/link"
import type { CatalogApp } from "../lib/apps.js"
import { Platform } from "../platform/platform.js"

const appLink = "#ren-app:"

export const MarkdownApps = createContext<ReadonlyArray<CatalogApp>>([])

export function MarkdownLink({ node: _node, href, children, onClick, ...rest }: ComponentProps<"a"> & ExtraProps) {
  const platform = Platform.usePlatform()
  const apps = use(MarkdownApps)
  const app = href?.startsWith(appLink) ? apps.find((each) => each.slug === href.slice(appLink.length)) : undefined
  if (app) return <AppMention app={app} />
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || href === undefined || !/^https?:/iu.test(href)) return
    event.preventDefault()
    platform.openExternal(href)
  }
  return (
    <Link appearance="content" href={href} external onClick={open} {...rest}>
      {children}
    </Link>
  )
}
