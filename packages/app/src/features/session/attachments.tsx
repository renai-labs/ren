import { Session } from "@ren/schema/session"
import { IconFile, IconFileTypePdf, IconPhoto, IconUpload, IconX } from "@tabler/icons-react"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@ren/ui/attachment"
import { ImageLightbox } from "../../components/image-lightbox.js"
import { formatBytes } from "../../lib/format.js"
import type { PickedFile } from "../../lib/use-attachments.js"
import { FileDrop } from "../../platform/file-drop.js"

function iconFor(mime: string) {
  if (mime.startsWith("image/")) return <IconPhoto />
  if (mime === "application/pdf") return <IconFileTypePdf />
  return <IconFile />
}

export function AttachmentChips(props: { files: ReadonlyArray<PickedFile>; onRemove: (id: string) => void }) {
  if (props.files.length === 0) return null
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

export function DropOverlay(props: { onFiles: (files: ReadonlyArray<File>) => void }) {
  const dragging = FileDrop.use(props.onFiles)
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
