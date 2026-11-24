export * as Uploads from "./uploads.js"

import { Struct } from "effect"
import { useState } from "react"
import type { Ren, WriteResultUpload } from "../generated/index.js"

type Client = ReturnType<typeof Ren.make>

export type Transfer<File> = (
  form: WriteResultUpload,
  file: File,
  options: { readonly mime: string; readonly signal: AbortSignal; readonly onProgress: (fraction: number) => void },
) => Promise<void>

export interface Entry<File> {
  readonly file: File
  readonly spaceId?: string | undefined
  readonly path: string
  readonly name: string
  readonly mime: string
  readonly size: number
  readonly error?: string
}

export interface Upload<File> extends Entry<File> {
  readonly id: string
  readonly progress: number
  readonly controller: AbortController
}

export const send = <File>(
  client: Client,
  transfer: Transfer<File>,
  entry: Entry<File>,
  options: { readonly signal?: AbortSignal; readonly onProgress?: (fraction: number) => void } = {},
) =>
  client.drive
    .startUpload({ ...(entry.spaceId && { spaceId: entry.spaceId }), path: entry.path, size: entry.size })
    .then((form) =>
      transfer(form, entry.file, {
        mime: entry.mime,
        signal: options.signal ?? new AbortController().signal,
        onProgress: options.onProgress ?? (() => undefined),
      }),
    )

export function useQueue<File>(options: {
  readonly client: Client
  readonly transfer: Transfer<File>
  readonly describe: (error: unknown) => string
  readonly onDone: (upload: Upload<File>) => void
}) {
  const [uploads, setUploads] = useState<ReadonlyArray<Upload<File>>>([])
  const replace = (next: Upload<File>) =>
    setUploads((current) => current.map((upload) => (upload.id === next.id ? next : upload)))
  const advance = (id: string, progress: number) =>
    setUploads((current) =>
      current.some((upload) => upload.id === id && upload.progress !== progress)
        ? current.map((upload) => (upload.id === id ? { ...upload, progress } : upload))
        : current,
    )
  const drop = (id: string) => setUploads((current) => current.filter((upload) => upload.id !== id))
  const run = (upload: Upload<File>) =>
    void send(options.client, options.transfer, upload, {
      signal: upload.controller.signal,
      onProgress: (fraction) => advance(upload.id, Math.round(fraction * 100)),
    }).then(
      () => {
        if (upload.controller.signal.aborted) return
        drop(upload.id)
        options.onDone(upload)
      },
      (error: unknown) => {
        if (!upload.controller.signal.aborted) replace({ ...upload, error: options.describe(error) })
      },
    )
  return {
    uploads,
    start: (entries: ReadonlyArray<Entry<File>>) => {
      const added = entries.map((entry): Upload<File> => ({
        ...entry,
        id: crypto.randomUUID(),
        progress: 0,
        controller: new AbortController(),
      }))
      setUploads((current) => [...current, ...added])
      for (const upload of added.filter((each) => !each.error)) run(upload)
    },
    retry: (upload: Upload<File>) => {
      const next = { ...Struct.omit(upload, ["error"]), progress: 0, controller: new AbortController() }
      replace(next)
      run(next)
    },
    cancel: (upload: Upload<File>) => {
      upload.controller.abort()
      drop(upload.id)
    },
  }
}
