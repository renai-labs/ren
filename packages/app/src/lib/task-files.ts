import { useRef } from "react"
import { Uploads } from "@ren/client/react"
import { Drive } from "@ren/schema/drive"
import { toast } from "@ren/ui/sonner"
import { FileName } from "@ren/util/file-name"
import type { Attached, Upload } from "../components/markdown-editor.js"
import { errorMessage } from "./errors.js"
import { formatBytes } from "./format.js"
import { RouterContext } from "./router-context.js"

interface Place {
  readonly spaceId: string
  readonly identifier: string
}

const pastedName = "Pasted image.png"

export function useTaskUploads() {
  const { client, platform } = RouterContext.useRouterContext()
  const transfer = platform.upload
  if (!transfer) return
  const listed = async (task: Place, folder: string, cursor?: string): Promise<ReadonlyArray<string>> => {
    const page = await client.files.list({ source: "drive", spaceId: task.spaceId, folder, ...(cursor && { cursor }) })
    const paths = page.entries.map((entry) => FileName.base(entry.path))
    return page.cursor ? [...paths, ...(await listed(task, folder, page.cursor))] : paths
  }
  return async (task: Place, files: ReadonlyArray<File>): Promise<ReadonlyArray<Attached | undefined>> => {
    const large = files.filter((file) => file.size > Drive.maxUploadBytes)
    if (large.length > 0)
      toast.error(large.length === 1 ? `${large.at(0)?.name ?? "A file"} is too large` : "Some files are too large", {
        description: `A file can be at most ${formatBytes(Drive.maxUploadBytes)}.`,
      })
    const folder = `${Drive.taskFolder(task.identifier)}/`
    const taken = new Set(await listed(task, folder))
    const named = files.map((file) => {
      if (file.size > Drive.maxUploadBytes) return
      const name = FileName.free(file.name || pastedName, taken)
      taken.add(name)
      return { file, name, mime: file.type || Drive.typeOf(name) }
    })
    const sent = await Promise.allSettled(
      named.map((each) => {
        if (!each) return Promise.resolve(undefined)
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
    return sent.map((result) => (result.status === "fulfilled" ? result.value : undefined))
  }
}

const withoutLink = (markdown: string, link: string) =>
  markdown.replaceAll(new RegExp(`!?\\[[^\\]]*\\]\\(${link.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\)`, "gu"), "")

export function useHeldFiles() {
  const { client } = RouterContext.useRouterContext()
  const upload = useTaskUploads()
  const held = useRef(new Map<string, File>())
  const used = (markdown: string) => [...held.current].filter((entry) => markdown.includes(entry[0]))
  const send = async (task: Place & { readonly id: string }, markdown: string) => {
    const files = used(markdown)
    if (!upload || files.length === 0) return
    const sent = await upload(
      task,
      files.map((entry) => entry[1]),
    )
    for (const entry of files) {
      held.current.delete(entry[0])
      URL.revokeObjectURL(entry[0])
    }
    const next = files.reduce((text, entry, index) => {
      const attached = sent.at(index)
      return attached ? text.replaceAll(entry[0], attached.link) : withoutLink(text, entry[0])
    }, markdown)
    await client.task.update({ id: task.id, description: next.trim() })
  }
  return {
    hold: upload
      ? (((files) =>
          Promise.resolve(
            files.map((file): Attached => {
              const link = URL.createObjectURL(file)
              held.current.set(link, file)
              return { name: file.name || pastedName, link, image: file.type.startsWith("image/") }
            }),
          )) satisfies Upload)
      : undefined,
    without: (markdown: string) => [...held.current.keys()].reduce(withoutLink, markdown),
    attach: (task: Place & { readonly id: string; readonly identifier: string }, markdown: string) =>
      void send(task, markdown).catch((error: unknown) =>
        toast.error(`Couldn’t add the files to ${task.identifier}`, { description: errorMessage(error) }),
      ),
  }
}
