import { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import {
  IconDownload,
  IconFile,
  IconFileCode,
  IconFileSpreadsheet,
  IconFileText,
  IconFileTypePdf,
  IconFileZip,
  IconMusic,
  IconPhoto,
  IconRefresh,
  IconUpload,
  IconVideo,
  IconX,
} from "@tabler/icons-react"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@ren/ui/attachment"
import { Spinner } from "@ren/ui/spinner"
import { cn } from "cn"
import { ImageSet, ImageTrigger } from "../../components/image-set.js"
import { formatBytes } from "../../lib/format.js"
import { useDriveFile } from "../../lib/use-drive-file.js"
import { maxFileBytes, type Upload } from "../../lib/use-uploads.js"
import { FileDrop } from "../../platform/file-drop.js"

const code = /\.(ts|tsx|js|jsx|py|go|rs|rb|java|c|cpp|h|sh|sql|yaml|yml|toml)$/iu

function FileIcon(props: { name: string; mime: string }) {
  if (props.mime.startsWith("image/")) return <IconPhoto />
  if (props.mime === "application/pdf") return <IconFileTypePdf />
  if (props.mime.startsWith("audio/")) return <IconMusic />
  if (props.mime.startsWith("video/")) return <IconVideo />
  if (/zip|compressed|tar|gzip/u.test(props.mime)) return <IconFileZip />
  if (/csv|spreadsheet|excel/u.test(props.mime)) return <IconFileSpreadsheet />
  if (code.test(props.name) || props.mime === "application/json") return <IconFileCode />
  if (props.mime.startsWith("text/")) return <IconFileText />
  return <IconFile />
}

function DriveFileCard(props: {
  spaceId: string | undefined
  file: SessionMessage.DriveFile
  disabled?: boolean | undefined
  onRemove?: (() => void) | undefined
}) {
  const file = props.file
  const drive = useDriveFile(props.spaceId, file)
  const thumbnail = drive.image && !drive.deleted ? drive.thumbnail : undefined
  return (
    <Attachment size="sm" state={drive.deleted ? "error" : "done"}>
      {thumbnail ? (
        <AttachmentMedia variant="image">
          <ImageTrigger src={thumbnail} name={file.name} download={drive.download} className="size-full cursor-zoom-in">
            <img src={thumbnail} alt={file.name} onError={drive.reload} />
          </ImageTrigger>
        </AttachmentMedia>
      ) : (
        <AttachmentMedia>
          <FileIcon name={file.name} mime={file.mime} />
        </AttachmentMedia>
      )}
      <AttachmentContent>
        <AttachmentTitle>{file.name}</AttachmentTitle>
        <AttachmentDescription className="tabular-nums">
          {drive.deleted ? "Not in the drive" : formatBytes(file.size)}
        </AttachmentDescription>
      </AttachmentContent>
      {drive.deleted || thumbnail ? null : <AttachmentTrigger aria-label={`Open ${file.name}`} onClick={drive.open} />}
      <AttachmentActions>
        {drive.deleted || props.onRemove ? null : (
          <AttachmentAction aria-label={`Download ${file.name}`} onClick={drive.download}>
            <IconDownload />
          </AttachmentAction>
        )}
        {props.onRemove ? (
          <AttachmentAction aria-label={`Remove ${file.name}`} disabled={props.disabled} onClick={props.onRemove}>
            <IconX />
          </AttachmentAction>
        ) : null}
      </AttachmentActions>
    </Attachment>
  )
}

export function DriveFileCards(props: {
  spaceId: string | undefined
  files: ReadonlyArray<SessionMessage.DriveFile>
  className?: string | undefined
}) {
  return (
    <AttachmentGroup className={props.className}>
      {props.files.map((file) => (
        <DriveFileCard key={file.path} spaceId={props.spaceId} file={file} />
      ))}
    </AttachmentGroup>
  )
}

function UploadChip(props: {
  upload: Upload
  disabled: boolean | undefined
  onRetry: () => void
  onCancel: () => void
}) {
  const upload = props.upload
  const failed = Boolean(upload.error)
  return (
    <Attachment size="sm" state={failed ? "error" : "uploading"}>
      <AttachmentMedia>{failed ? <FileIcon name={upload.name} mime={upload.mime} /> : <Spinner />}</AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{upload.name}</AttachmentTitle>
        <AttachmentDescription className={cn(!failed && "tabular-nums")}>
          {upload.error ?? `Uploading · ${formatBytes(upload.file.size)}`}
        </AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions>
        {failed ? (
          <AttachmentAction aria-label={`Retry ${upload.name}`} disabled={props.disabled} onClick={props.onRetry}>
            <IconRefresh />
          </AttachmentAction>
        ) : null}
        <AttachmentAction aria-label={`Remove ${upload.name}`} disabled={props.disabled} onClick={props.onCancel}>
          <IconX />
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  )
}

export function UploadChips(props: {
  spaceId: string | undefined
  files: ReadonlyArray<SessionMessage.DriveFile>
  uploads: ReadonlyArray<Upload>
  disabled: boolean | undefined
  onRetry: (upload: Upload) => void
  onCancel: (upload: Upload) => void
  onRemove: (path: string) => void
}) {
  if (props.files.length === 0 && props.uploads.length === 0) return null
  return (
    <ImageSet>
      <AttachmentGroup>
        {props.files.map((file) => (
          <DriveFileCard
            key={file.path}
            spaceId={props.spaceId}
            file={file}
            disabled={props.disabled}
            onRemove={() => props.onRemove(file.path)}
          />
        ))}
        {props.uploads.map((upload) => (
          <UploadChip
            key={upload.id}
            upload={upload}
            disabled={props.disabled}
            onRetry={() => props.onRetry(upload)}
            onCancel={() => props.onCancel(upload)}
          />
        ))}
      </AttachmentGroup>
    </ImageSet>
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
        <span className="text-xs">
          Up to {Session.maxDriveFiles} files, {formatBytes(maxFileBytes)} each
        </span>
      </div>
    </div>
  )
}
