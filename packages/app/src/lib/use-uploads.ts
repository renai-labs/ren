import { useState } from "react"
import { Composer } from "@ren/chat"
import { Drive } from "@ren/schema/drive"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import { toast } from "@ren/ui/sonner"
import { FileName } from "@ren/util/file-name"
import { Struct } from "effect"
import { errorMessage } from "./errors.js"
import { formatBytes } from "./format.js"
import { RouterContext } from "./router-context.js"

export const maxFileBytes = 100_000_000

export interface Upload {
  readonly id: string
  readonly file: File
  readonly name: string
  readonly mime: string
  readonly path: string
  readonly controller: AbortController
  readonly error?: string
}

export interface Target {
  readonly sessionId: Session.ID
  readonly spaceId: string | undefined
  readonly update: (change: (draft: Composer.Draft) => Composer.Draft) => void
}

export function useUploads(target: Target, draft: Composer.Draft) {
  const { client, platform } = RouterContext.useRouterContext()
  const [uploads, setUploads] = useState<ReadonlyArray<Upload>>([])
  const drop = (id: string) => setUploads((current) => current.filter((upload) => upload.id !== id))
  const change = (next: Upload) =>
    setUploads((current) => current.map((upload) => (upload.id === next.id ? next : upload)))
  const send = (upload: Upload, spaceId: string) =>
    void client.drive
      .startUpload({ spaceId, path: upload.path, size: upload.file.size })
      .then((form) => platform.upload?.(form, upload.file, upload.controller.signal))
      .then(
        () => {
          if (upload.controller.signal.aborted) return
          target.update((current) =>
            Composer.withFile(current, {
              path: upload.path,
              name: upload.name,
              mime: upload.mime,
              size: upload.file.size,
            }),
          )
          drop(upload.id)
        },
        (error: unknown) => {
          if (!upload.controller.signal.aborted) change({ ...upload, error: errorMessage(error) })
        },
      )
  return {
    uploads,
    add: (incoming: ReadonlyArray<File>) => {
      const spaceId = target.spaceId
      if (incoming.length === 0 || !spaceId) return
      if (!platform.upload) {
        toast.error("Files can’t be attached here")
        return
      }
      if (Composer.files(draft).length + uploads.length + incoming.length > Session.maxDriveFiles) {
        toast.error("Too many files", { description: `A message can attach ${Session.maxDriveFiles} files.` })
        return
      }
      const large = incoming.filter((file) => file.size > maxFileBytes)
      if (large.length > 0)
        toast.error(large.length === 1 ? `${large.at(0)?.name ?? "A file"} is too large` : "Some files are too large", {
          description: `A file can be at most ${formatBytes(maxFileBytes)}.`,
        })
      const messageId = draft.messageId ?? SessionMessage.ID.create()
      if (!draft.messageId) target.update((current) => Composer.withMessageID(current, messageId))
      const taken = new Set([...Composer.files(draft), ...uploads].map((file) => file.name))
      const added = incoming
        .filter((file) => file.size <= maxFileBytes)
        .map((file): Upload => {
          const name = FileName.free(file.name || "Pasted file", taken)
          taken.add(name)
          return {
            id: crypto.randomUUID(),
            file,
            name,
            mime: file.type && file.type !== "application/octet-stream" ? file.type : Drive.typeOf(name),
            path: `${Drive.uploadsOf(target.sessionId, messageId)}/${name}`,
            controller: new AbortController(),
          }
        })
      setUploads((current) => [...current, ...added])
      for (const upload of added) send(upload, spaceId)
    },
    retry: (upload: Upload) => {
      if (!target.spaceId) return
      const next = { ...Struct.omit(upload, ["error"]), controller: new AbortController() }
      change(next)
      send(next, target.spaceId)
    },
    cancel: (upload: Upload) => {
      upload.controller.abort()
      drop(upload.id)
    },
    remove: (path: string) => {
      target.update((current) => Composer.withoutFile(current, path))
      if (target.spaceId) void client.drive.delete({ spaceId: target.spaceId, path }).catch(() => undefined)
    },
  }
}
