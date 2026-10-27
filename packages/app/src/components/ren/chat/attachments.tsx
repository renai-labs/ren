import { useEffect, useState } from "react"
import { Session } from "@ren/schema/session"
import { IconFile, IconFileTypePdf, IconPhoto, IconUpload, IconX } from "@tabler/icons-react"
import { toast } from "sonner"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"
import { ImageLightbox } from "@/components/ren/image-lightbox"
import { formatBytes } from "@/lib/format"

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

const iconFor = (mime: string) =>
  mime.startsWith("image/") ? <IconPhoto /> : mime === "application/pdf" ? <IconFileTypePdf /> : <IconFile />

export function AttachmentChips(props: { files: ReadonlyArray<PickedFile>; onRemove: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <AttachmentGroup>
        {props.files.map((file) => (
          <Attachment key={file.id} size="sm">
            {file.mime.startsWith("image/") ? (
              <AttachmentMedia variant="image">
                <ImageLightbox src={file.url} alt={file.name} className="size-full cursor-zoom-in">
                  <img src={file.url} alt={file.name} />
                </ImageLightbox>
              </AttachmentMedia>
            ) : (
              <AttachmentMedia>{iconFor(file.mime)}</AttachmentMedia>
            )}
            <AttachmentContent>
              <AttachmentTitle>{file.name}</AttachmentTitle>
              <AttachmentDescription className="tabular-nums">{formatBytes(file.size)}</AttachmentDescription>
            </AttachmentContent>
            <AttachmentActions>
              <AttachmentAction aria-label={`Remove ${file.name}`} onClick={() => props.onRemove(file.id)}>
                <IconX />
              </AttachmentAction>
            </AttachmentActions>
          </Attachment>
        ))}
      </AttachmentGroup>
      <p className="px-1 text-xs text-muted-foreground">
        Ren can’t receive files in chat yet. Remove them to send your message.
      </p>
    </div>
  )
}

const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") === true

export function DropOverlay(props: { onFiles: (files: ReadonlyArray<File>) => void }) {
  const [dragging, setDragging] = useState(false)
  const onFiles = props.onFiles
  useEffect(() => {
    const depth = { current: 0 }
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth.current += 1
      setDragging(true)
    }
    const over = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault()
    }
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDragging(false)
    }
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth.current = 0
      setDragging(false)
      onFiles([...(event.dataTransfer?.files ?? [])])
    }
    window.addEventListener("dragenter", enter)
    window.addEventListener("dragover", over)
    window.addEventListener("dragleave", leave)
    window.addEventListener("drop", drop)
    return () => {
      window.removeEventListener("dragenter", enter)
      window.removeEventListener("dragover", over)
      window.removeEventListener("dragleave", leave)
      window.removeEventListener("drop", drop)
    }
  }, [onFiles])
  if (!dragging) return null
  return (
    <div className="pointer-events-none fixed inset-2 z-50 flex animate-in items-center justify-center rounded-2xl border-2 border-dashed border-ring/60 bg-background/80 backdrop-blur-sm duration-150 ease-out fade-in-0 motion-reduce:animate-none">
      <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
        <IconUpload className="size-6 text-foreground" />
        <span className="text-foreground">Drop files to attach</span>
        <span className="text-xs">Images, PDFs or any file, up to {formatBytes(Session.maxFileBytes)} in total</span>
      </div>
    </div>
  )
}
