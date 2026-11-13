import { useState } from "react"
import type { SessionMessage } from "@ren/schema/session/message"
import { useQuery } from "@tanstack/react-query"
import { toast } from "@ren/ui/sonner"
import { errorMessage, errorStatus } from "./errors.js"
import { RouterContext } from "./router-context.js"

const linkLifetime = 10 * 60_000

const inline = (mime: string) =>
  mime.startsWith("image/") ||
  mime.startsWith("audio/") ||
  mime.startsWith("video/") ||
  mime === "application/pdf" ||
  mime === "application/json" ||
  (mime.startsWith("text/") && mime !== "text/html")

const probe = typeof document === "undefined" ? undefined : document.createElement("video")

export const playableKind = (mime: string) => {
  if (!probe?.canPlayType(mime)) return
  if (mime.startsWith("video/")) return "video"
  return mime.startsWith("audio/") ? "audio" : undefined
}

export function useDriveFile(spaceId: string | undefined, file: SessionMessage.DriveFile) {
  const { api, platform, queryClient } = RouterContext.useRouterContext()
  const [gone, setGone] = useState(false)
  const [reloaded, setReloaded] = useState(false)
  const image = file.mime.startsWith("image/")
  const link = (disposition: "inline" | "attachment") => ({
    ...api.drive.download.queryOptions({ ...(spaceId && { spaceId }), path: file.path, disposition }),
    staleTime: linkLifetime,
    retry: (count: number, error: unknown) => errorStatus(error) !== 404 && count < 1,
  })
  const shown = useQuery({
    ...link("inline"),
    enabled: Boolean(spaceId) && !gone && (image || playableKind(file.mime) !== undefined),
  })
  const fail = (error: unknown) => {
    if (errorStatus(error) === 404) setGone(true)
    else toast.error(`Could not open ${file.name}`, { description: errorMessage(error) })
  }
  const download = () =>
    void queryClient.query(link("attachment")).then((found) => {
      if (platform.redirect) platform.redirect(found.url)
      else platform.openExternal(found.url)
    }, fail)
  return {
    image,
    url: shown.data?.url,
    deleted: gone || errorStatus(shown.error) === 404,
    refresh: () => shown.refetch().then((next) => next.data?.url),
    reload: () => {
      if (reloaded) return
      setReloaded(true)
      void shown.refetch()
    },
    bytes: async (signal: AbortSignal) => {
      const found = await queryClient.query(link("inline"))
      // oxlint-disable-next-line no-restricted-globals -- the signed drive link is not a Ren API call and carries no Ren token
      const response = await fetch(found.url, { credentials: "omit", signal })
      if (!response.ok) throw new Error(`UnexpectedStatus: ${response.status}`)
      return response.arrayBuffer()
    },
    open: () => {
      if (!inline(file.mime)) {
        download()
        return
      }
      const tab = platform.blankTab?.() ?? null
      void queryClient.query(link("inline")).then(
        (found) => {
          if (tab) tab.location.href = found.url
          else platform.openExternal(found.url)
        },
        (error: unknown) => {
          tab?.close()
          fail(error)
        },
      )
    },
    download,
  }
}
