import { useState } from "react"
import { DriveQuery } from "@ren/client/react"
import type { SessionMessage } from "@ren/schema/session/message"
import { useQuery } from "@tanstack/react-query"
import { toast } from "@ren/ui/sonner"
import { errorMessage, errorStatus } from "./errors.js"
import { RouterContext } from "./router-context.js"

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

export const useDriveLink = (spaceId: string | undefined) => {
  const { api } = RouterContext.useRouterContext()
  return (path: string, disposition: "inline" | "attachment") =>
    DriveQuery.link(api, { ...(spaceId && { spaceId }), path, disposition })
}

export function useDriveDownload(spaceId: string | undefined) {
  const { platform, queryClient } = RouterContext.useRouterContext()
  const link = useDriveLink(spaceId)
  return (path: string) =>
    queryClient.query(link(path, "attachment")).then((found) => {
      if (platform.redirect) platform.redirect(found.url)
      else platform.openExternal(found.url)
    })
}

export function useDriveFile(spaceId: string | undefined, file: SessionMessage.DriveFile) {
  const { platform, queryClient } = RouterContext.useRouterContext()
  const [gone, setGone] = useState(false)
  const [reloaded, setReloaded] = useState(false)
  const image = file.mime.startsWith("image/")
  const linkOf = useDriveLink(spaceId)
  const link = (disposition: "inline" | "attachment") => linkOf(file.path, disposition)
  const save = useDriveDownload(spaceId)
  const shown = useQuery({
    ...link("inline"),
    enabled: Boolean(spaceId) && !gone && (image || playableKind(file.mime) !== undefined),
  })
  const fail = (error: unknown) => {
    if (errorStatus(error) === 404) setGone(true)
    else toast.error(`Could not open ${file.name}`, { description: errorMessage(error) })
  }
  const download = () => void save(file.path).then(undefined, fail)
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
    bytes: async (signal: AbortSignal, limit?: number) => {
      const found = await queryClient.query(link("inline"))
      // oxlint-disable-next-line no-restricted-globals -- the signed drive link is not a Ren API call and carries no Ren token
      const response = await fetch(found.url, { credentials: "omit", signal })
      if (!response.ok) throw new Error(`UnexpectedStatus: ${response.status}`)
      if (limit === undefined || !response.body) return response.arrayBuffer()
      const reader = response.body.getReader()
      type Chunks = ReadonlyArray<Uint8Array<ArrayBuffer>>
      const read = async (chunks: Chunks, size: number): Promise<Chunks> => {
        const next = size < limit ? await reader.read() : undefined
        if (!next || next.done) return chunks
        return read([...chunks, next.value], size + next.value.byteLength)
      }
      const chunks = await read([], 0)
      void reader.cancel()
      return (await new Blob([...chunks]).arrayBuffer()).slice(0, limit)
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
