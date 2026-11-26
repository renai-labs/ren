import type { ReactNode } from "react"
import { Button } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@ren/ui/dialog"
import { FileIcon } from "@ren/ui/file-icon"
import { Spinner } from "@ren/ui/spinner"
import { IconDownload, IconX } from "@tabler/icons-react"
import { useQuery } from "@tanstack/react-query"
import type { SessionMessage } from "@ren/schema/session/message"
import { QueryResult } from "../../lib/query-result.js"
import { RouterContext } from "../../lib/router-context.js"
import { playableKind, useDriveFile, useDriveLink } from "../../lib/use-drive-file.js"
import { OpenFile } from "../file-browser.js"
import { Viewer } from "./file-preview.js"
import { kindOf } from "./preview.js"

function Media(props: { space: string | undefined; path: string; name: string; kind: "image" | "video" | "audio" }) {
  const link = useQuery(useDriveLink(props.space)(props.path, "inline"))
  const url = link.data?.url
  return (
    <div
      data-slot="viewer-media"
      className="flex min-h-0 flex-1 items-center justify-center overflow-auto overscroll-contain bg-muted/40 p-6"
    >
      {url === undefined ? <Spinner /> : null}
      {url && props.kind === "image" ? (
        <img src={url} alt={props.name} className="max-h-full max-w-full rounded-md object-contain" />
      ) : null}
      {url && props.kind === "video" ? (
        // oxlint-disable-next-line jsx-a11y/media-has-caption -- a drive video has no caption track to offer
        <video src={url} controls className="max-h-full max-w-full rounded-md" />
      ) : null}
      {url && props.kind === "audio" ? (
        // oxlint-disable-next-line jsx-a11y/media-has-caption -- a drive recording has no caption track to offer
        <audio src={url} controls className="w-full max-w-xl" />
      ) : null}
    </div>
  )
}

export function DriveFileView(props: {
  space: string | undefined
  file: SessionMessage.DriveFile
  aside?: ReactNode | undefined
  onClose: () => void
  onFolder: (folder: string) => void
}) {
  const { api } = RouterContext.useRouterContext()
  const file = props.file
  const drive = useDriveFile(props.space, file)
  const kind = kindOf(file)
  const media = file.mime.startsWith("image/") ? "image" : playableKind(file.mime)
  const read = useQuery({
    ...api.files.read.queryOptions({ source: "drive", ...(props.space && { spaceId: props.space }), path: file.path }),
    enabled: kind === undefined && media === undefined,
  })
  if (kind)
    return (
      <Viewer
        kind={kind}
        file={file}
        bytes={drive.bytes}
        aside={props.aside}
        onClose={props.onClose}
        onDownload={drive.download}
      />
    )
  const body = media ? (
    <Media space={props.space} path={file.path} name={file.name} kind={media} />
  ) : (
    <div className="flex min-h-0 flex-1 flex-col">
      <OpenFile
        read={{ result: QueryResult.of(read), refresh: () => void read.refetch() }}
        tab={{ path: file.path, preview: false }}
        onFolder={props.onFolder}
        onMention={undefined}
      />
    </div>
  )
  return (
    <>
      <div data-slot="viewer-bar" className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <FileIcon name={file.name} className="ml-1" />
        <p data-slot="viewer-name" className="min-w-0 flex-1 truncate text-sm font-medium">
          {file.name}
        </p>
        <Button variant="ghost" size="icon-sm" aria-label="Download" onClick={drive.download}>
          <IconDownload />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={props.onClose}>
          <IconX />
        </Button>
      </div>
      {props.aside ? (
        <div data-slot="viewer-split" className="flex min-h-0 flex-1">
          <div data-slot="viewer-body" className="flex min-h-0 min-w-0 flex-1 flex-col">
            {body}
          </div>
          {props.aside}
        </div>
      ) : (
        body
      )}
    </>
  )
}

export function DriveFilePreview(props: {
  space: string | undefined
  file: SessionMessage.DriveFile
  open: boolean
  onOpenChange: (open: boolean) => void
  onFolder: (folder: string) => void
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(90vh,--spacing(260))] w-[min(96vw,--spacing(380))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">{props.file.name}</DialogTitle>
        <DialogDescription className="sr-only">Preview of {props.file.name}</DialogDescription>
        {props.open ? (
          <DriveFileView
            space={props.space}
            file={props.file}
            onClose={() => props.onOpenChange(false)}
            onFolder={props.onFolder}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
