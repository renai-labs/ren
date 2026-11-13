import { useState } from "react"
import { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import { IconDownload, IconRefresh, IconUpload, IconX } from "@tabler/icons-react"
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
import { FileIcon } from "@ren/ui/file-icon"
import { cn } from "cn"
import { FilePreview } from "../../components/file-preview/file-preview.js"
import { kindOf } from "../../components/file-preview/preview.js"
import { MediaPlayer } from "../../components/media-player.js"
import { ImageTrigger } from "../../components/image-set.js"
import { MediaUnavailable } from "../../components/media-unavailable.js"
import { formatBytes } from "../../lib/format.js"
import { playableKind, useDriveFile } from "../../lib/use-drive-file.js"
import { maxFileBytes, type Upload } from "../../lib/use-uploads.js"
import { FileDrop } from "../../platform/file-drop.js"
import { HtmlPage } from "./html-page.js"
import { HtmlPageBridge } from "./html-page-bridge.js"

function DriveFileThumbnail(props: {
  file: SessionMessage.DriveFile
  thumbnail: string | undefined
  onError: () => void
  onDownload: () => void
}) {
  if (!props.thumbnail)
    return (
      <AttachmentMedia>
        <FileIcon name={props.file.name} mime={props.file.mime} />
      </AttachmentMedia>
    )
  return (
    <AttachmentMedia variant="image">
      <ImageTrigger
        src={props.thumbnail}
        name={props.file.name}
        download={props.onDownload}
        className="size-full cursor-zoom-in"
      >
        <img src={props.thumbnail} alt={props.file.name} onError={props.onError} />
      </ImageTrigger>
    </AttachmentMedia>
  )
}

function DriveFileCard(props: {
  spaceId: string | undefined
  file: SessionMessage.DriveFile
  disabled?: boolean | undefined
  onRemove?: (() => void) | undefined
}) {
  const drive = useDriveFile(props.spaceId, props.file)
  if (drive.image && drive.deleted && !props.onRemove)
    return <MediaUnavailable reason="Not in the drive" title={props.file.name} />
  return <DriveFileChip file={props.file} drive={drive} disabled={props.disabled} onRemove={props.onRemove} />
}

function DriveFileChip(props: {
  file: SessionMessage.DriveFile
  drive: ReturnType<typeof useDriveFile>
  disabled?: boolean | undefined
  onRemove?: (() => void) | undefined
}) {
  const file = props.file
  const drive = props.drive
  const thumbnail = drive.image && !drive.deleted ? drive.url : undefined
  const kind = kindOf(file)
  const [previewing, setPreviewing] = useState(false)
  return (
    <Attachment size="sm" state={drive.deleted ? "error" : "done"}>
      <DriveFileThumbnail file={file} thumbnail={thumbnail} onError={drive.reload} onDownload={drive.download} />
      <AttachmentContent>
        <AttachmentTitle>{file.name}</AttachmentTitle>
        <AttachmentDescription className="tabular-nums">
          {drive.deleted ? "Not in the drive" : formatBytes(file.size)}
        </AttachmentDescription>
      </AttachmentContent>
      {drive.deleted || thumbnail ? null : (
        <AttachmentTrigger aria-label={`Open ${file.name}`} onClick={kind ? () => setPreviewing(true) : drive.open} />
      )}
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
      <FilePreview
        kind={kind}
        file={file}
        open={previewing}
        onOpenChange={setPreviewing}
        bytes={drive.bytes}
        onDownload={drive.download}
      />
    </Attachment>
  )
}

const inlineKind = (file: SessionMessage.DriveFile) =>
  file.mime === "text/html" && file.size <= HtmlPageBridge.maxPageBytes ? "page" : playableKind(file.mime)

export function DriveFileCards(props: {
  spaceId: string | undefined
  files: ReadonlyArray<SessionMessage.DriveFile>
  className?: string | undefined
}) {
  const cards = props.files.filter((file) => inlineKind(file) === undefined)
  return (
    <>
      {props.files.map((file) => {
        const kind = inlineKind(file)
        if (kind === "page") return <HtmlPage key={file.path} spaceId={props.spaceId} file={file} />
        return kind ? <MediaPlayer key={file.path} spaceId={props.spaceId} file={file} kind={kind} /> : null
      })}
      {cards.length > 0 ? (
        <AttachmentGroup className={props.className}>
          {cards.map((file) => (
            <DriveFileCard key={file.path} spaceId={props.spaceId} file={file} />
          ))}
        </AttachmentGroup>
      ) : null}
    </>
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
      <AttachmentMedia>
        <FileIcon name={upload.name} mime={upload.mime} />
      </AttachmentMedia>
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
  return (
    <>
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
    </>
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
