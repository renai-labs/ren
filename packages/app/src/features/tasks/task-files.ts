import { Uploads } from "@ren/client/react"
import { Drive } from "@ren/schema/drive"
import { toast } from "@ren/ui/sonner"
import { FileName } from "@ren/util/file-name"
import type { Attached } from "../../components/markdown-editor.js"
import { errorMessage } from "../../lib/errors.js"
import { formatBytes } from "../../lib/format.js"
import { RouterContext } from "../../lib/router-context.js"

export function useTaskUploads(task: { readonly spaceId: string; readonly identifier: string }) {
  const { client, platform } = RouterContext.useRouterContext()
  const transfer = platform.upload
  if (!transfer) return
  const folder = `${Drive.taskFolder(task.identifier)}/`
  const listed = async (cursor?: string): Promise<ReadonlyArray<string>> => {
    const page = await client.files.list({ source: "drive", spaceId: task.spaceId, folder, ...(cursor && { cursor }) })
    const paths = page.entries.map((entry) => FileName.base(entry.path))
    return page.cursor ? [...paths, ...(await listed(page.cursor))] : paths
  }
  return async (files: ReadonlyArray<File>) => {
    const large = files.filter((file) => file.size > Drive.maxUploadBytes)
    if (large.length > 0)
      toast.error(large.length === 1 ? `${large.at(0)?.name ?? "A file"} is too large` : "Some files are too large", {
        description: `A file can be at most ${formatBytes(Drive.maxUploadBytes)}.`,
      })
    const taken = new Set(await listed())
    const named = files
      .filter((file) => file.size <= Drive.maxUploadBytes)
      .map((file) => {
        const name = FileName.free(file.name || "Pasted image.png", taken)
        taken.add(name)
        return { file, name, mime: file.type || Drive.typeOf(name) }
      })
    const sent = await Promise.allSettled(
      named.map((each) => {
        const id = toast.loading(`Uploading ${each.name}`)
        return Uploads.send(client, transfer, {
          file: each.file,
          spaceId: task.spaceId,
          path: `${folder}${each.name}`,
          name: each.name,
          mime: each.mime,
          size: each.file.size,
        }).then(
          (): Attached => {
            toast.dismiss(id)
            return {
              name: each.name,
              link: Drive.spaceLink(`${folder}${each.name}`),
              image: each.mime.startsWith("image/"),
            }
          },
          (error: unknown) => {
            toast.error(`Couldn’t upload ${each.name}`, { id, description: errorMessage(error) })
            throw error
          },
        )
      }),
    )
    return sent.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
  }
}
