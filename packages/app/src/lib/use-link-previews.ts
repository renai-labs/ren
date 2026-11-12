import { useState } from "react"
import { LinkPreview } from "@ren/schema/link-preview"
import type { Session } from "@ren/schema/session"
import { useQuery } from "@tanstack/react-query"
import { RouterContext } from "./router-context.js"

const urlPattern = /https?:\/\/[^\s<>()[\]"'`]+/giu

const urlsOf = (text: string) => [
  ...new Set(
    (text.match(urlPattern) ?? [])
      .map((url) => url.replace(/[.,;:!?*_]+$/u, ""))
      .filter((url) => LinkPreview.classify(url) !== undefined),
  ),
]

export function useLinkPreviews(input: {
  readonly root: Session.ID
  readonly text: string
  readonly streaming: boolean
}) {
  const { api, client } = RouterContext.useRouterContext()
  const [inView, setInView] = useState(false)
  const urls = urlsOf(input.text).slice(0, LinkPreview.maximumUrls)
  const watch = (node: HTMLElement | null) => {
    if (!node) return
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      setInView(true)
      observer.disconnect()
    })
    observer.observe(node)
    return () => observer.disconnect()
  }
  const found = useQuery({
    queryKey: Array.of<unknown>(...api.link.session.linkPreviews.mutationKey(), input.root, urls),
    queryFn: ({ signal }) => client.link.session.linkPreviews({ id: input.root, urls }, { signal }),
    enabled: urls.length > 0 && inView && !input.streaming,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })
  return {
    watch,
    previews:
      urls.length === 0 ? undefined : new Map((found.data ?? []).map((preview) => [preview.url, preview] as const)),
  }
}
