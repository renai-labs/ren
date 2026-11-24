import { Composer } from "@ren/chat"
import { Uploads } from "@ren/client/react"
import { Drive } from "@ren/schema/drive"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import { toast } from "@ren/ui/sonner"
import { FileName } from "@ren/util/file-name"
import { errorMessage } from "./errors.js"
import { formatBytes } from "./format.js"
import { RouterContext } from "./router-context.js"

export type Upload = Uploads.Upload<Blob>

export interface Target {
  readonly sessionId: Session.ID
  readonly spaceId: string | undefined
  readonly update: (change: (draft: Composer.Draft) => Composer.Draft) => void
}

const unavailable: Uploads.Transfer<Blob> = () => Promise.reject(new Error("Files can’t be attached here"))

export function useUploads(target: Target, draft: Composer.Draft) {
  const { client, platform } = RouterContext.useRouterContext()
  const queue = Uploads.useQueue({
    client,
    transfer: platform.upload ?? unavailable,
    describe: errorMessage,
    onDone: (upload) =>
      target.update((current) =>
        Composer.withFile(current, { path: upload.path, name: upload.name, mime: upload.mime, size: upload.size }),
      ),
  })
  return {
    uploads: queue.uploads,
    add: (incoming: ReadonlyArray<File>) => {
      const spaceId = target.spaceId
      if (incoming.length === 0 || !spaceId) return
      if (!platform.upload) {
        toast.error("Files can’t be attached here")
        return
      }
      if (Composer.files(draft).length + queue.uploads.length + incoming.length > Session.maxDriveFiles) {
        toast.error("Too many files", { description: `A message can attach ${Session.maxDriveFiles} files.` })
        return
      }
      const large = incoming.filter((file) => file.size > Drive.maxUploadBytes)
      if (large.length > 0)
        toast.error(large.length === 1 ? `${large.at(0)?.name ?? "A file"} is too large` : "Some files are too large", {
          description: `A file can be at most ${formatBytes(Drive.maxUploadBytes)}.`,
        })
      const messageId = draft.messageId ?? SessionMessage.ID.create()
      if (!draft.messageId) target.update((current) => Composer.withMessageID(current, messageId))
      const taken = new Set([...Composer.files(draft), ...queue.uploads].map((file) => file.name))
      queue.start(
        incoming
          .filter((file) => file.size <= Drive.maxUploadBytes)
          .map((file) => {
            const name = FileName.free(file.name || "Pasted file", taken)
            taken.add(name)
            return {
              file,
              spaceId,
              path: `${Drive.uploadsOf(target.sessionId, messageId)}/${name}`,
              name,
              mime: file.type && file.type !== "application/octet-stream" ? file.type : Drive.typeOf(name),
              size: file.size,
            }
          }),
      )
    },
    retry: queue.retry,
    cancel: queue.cancel,
    remove: (path: string) => {
      target.update((current) => Composer.withoutFile(current, path))
      if (target.spaceId)
        void client.files.delete({ source: "drive", spaceId: target.spaceId, path }).catch(() => undefined)
    },
  }
}
