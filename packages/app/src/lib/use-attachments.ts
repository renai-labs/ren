import { useState } from "react"
import { Session } from "@ren/schema/session"
import { toast } from "@ren/ui/sonner"
import { formatBytes } from "./format.js"

export interface PickedFile {
  readonly id: string
  readonly name: string
  readonly mime: string
  readonly size: number
  readonly url: string
}

const read = (file: File) =>
  new Promise<PickedFile>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener("load", () =>
      resolve({
        id: crypto.randomUUID(),
        name: file.name || "Pasted file",
        mime: file.type || "application/octet-stream",
        size: file.size,
        url: typeof reader.result === "string" ? reader.result : "",
      }),
    )
    reader.addEventListener("error", () => reject(reader.error ?? new Error(`Couldn’t read ${file.name}`)))
    reader.readAsDataURL(file)
  })

export function useAttachments() {
  const [files, setFiles] = useState<ReadonlyArray<PickedFile>>([])
  const add = (incoming: ReadonlyArray<File>) => {
    if (incoming.length === 0) return
    const total = [...files.map((file) => file.size), ...incoming.map((file) => file.size)].reduce((a, b) => a + b, 0)
    if (total > Session.maxFileBytes) {
      toast.error("Files are too large", {
        description: `A message’s files can total ${formatBytes(Session.maxFileBytes)}.`,
      })
      return
    }
    void Promise.all(incoming.map(read)).then(
      (picked) => setFiles((current) => [...current, ...picked]),
      (error: unknown) => toast.error("Couldn’t attach the file", { description: String(error) }),
    )
  }
  return {
    files,
    add,
    remove: (id: string) => setFiles((current) => current.filter((file) => file.id !== id)),
    clear: () => setFiles([]),
  }
}
