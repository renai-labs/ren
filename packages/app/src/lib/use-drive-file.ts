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

const previewable = (file: SessionMessage.DriveFile) =>
  file.mime === "application/pdf" ||
  file.mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
  /\.xlsx$/iu.test(file.name)

export function useDriveFile(spaceId: string | undefined, file: SessionMessage.DriveFile) {
  const { api, platform, queryClient } = RouterContext.useRouterContext()
  const [gone, setGone] = useState(false)
  const [reloaded, setReloaded] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const image = file.mime.startsWith("image/")
  const link = (disposition: "inline" | "attachment") => ({
    ...api.drive.download.queryOptions({ ...(spaceId && { spaceId }), path: file.path, disposition }),
    staleTime: linkLifetime,
    retry: (count: number, error: unknown) => errorStatus(error) !== 404 && count < 1,
  })
  const thumbnail = useQuery({ ...link("inline"), enabled: Boolean(spaceId) && image && !gone })
  const fail = (error: unknown) => {
    if (errorStatus(error) === 404) setGone(true)
    else toast.error(`Could not open ${file.name}`, { description: errorMessage(error) })
  }
  const download = () =>
    void queryClient.query(link("attachment")).then((found) => {
      if (platform.redirect) platform.redirect(found.url)
      else platform.openExternal(found.url)
    }, fail)
  const bytes = async (signal: AbortSignal) => {
    const found = await queryClient.query(link("inline")).catch((error: unknown) => {
      throw errorStatus(error) === 404 ? new Error("gone") : error
    })
    // oxlint-disable-next-line no-restricted-globals -- the signed drive link is not a Ren API call and carries no Ren token
    const response = await fetch(found.url, { credentials: "omit", signal })
    if (!response.ok) throw new Error(response.status === 404 ? "gone" : `Download failed with ${response.status}`)
    return response.arrayBuffer()
  }
  return {
    image,
    preview: { available: previewable(file), open: previewing, setOpen: setPreviewing, bytes },
    thumbnail: thumbnail.data?.url,
    deleted: gone || errorStatus(thumbnail.error) === 404,
    reload: () => {
      if (reloaded) return
      setReloaded(true)
      void thumbnail.refetch()
    },
    open: () => {
      if (previewable(file)) {
        setPreviewing(true)
        return
      }
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
