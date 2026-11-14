import type { FileSystemEntry } from "@ren/client"
import { Drive } from "@ren/schema/drive"
import { Button } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@ren/ui/dialog"
import { FileIcon } from "@ren/ui/file-icon"
import { Spinner } from "@ren/ui/spinner"
import { FileName } from "@ren/util/file-name"
import { IconDownload, IconX } from "@tabler/icons-react"
import { useQuery } from "@tanstack/react-query"
import { OpenFile } from "../../components/file-browser.js"
import { Viewer } from "../../components/file-preview/file-preview.js"
import { kindOf } from "../../components/file-preview/preview.js"
import { QueryResult } from "../../lib/query-result.js"
import { RouterContext } from "../../lib/router-context.js"
import { playableKind, useDriveFile, useDriveLink } from "../../lib/use-drive-file.js"

function Media(props: { space: string | undefined; path: string; name: string; kind: "image" | "video" | "audio" }) {
  const link = useQuery(useDriveLink(props.space)(props.path, "inline"))
  const url = link.data?.url
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto overscroll-contain bg-muted/40 p-6">
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

export function DriveViewer(props: {
  space: string | undefined
  path: string
  entry: FileSystemEntry | undefined
  onClose: () => void
  onFolder: (folder: string) => void
}) {
  const { api } = RouterContext.useRouterContext()
  const name = FileName.base(props.path)
  const file = { path: props.path, name, mime: props.entry?.mime ?? Drive.typeOf(name), size: props.entry?.size ?? 0 }
  const drive = useDriveFile(props.space, file)
  const kind = kindOf(file)
  const media = file.mime.startsWith("image/") ? "image" : playableKind(file.mime)
  const read = useQuery({
    ...api.files.read.queryOptions({ source: "drive", ...(props.space && { spaceId: props.space }), path: props.path }),
    enabled: kind === undefined && media === undefined,
  })
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent
        showCloseButton={false}
        className="flex h-dvh w-full max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:max-w-none data-open:zoom-in-100 data-closed:zoom-out-100"
      >
        <DialogTitle className="sr-only">{name}</DialogTitle>
        <DialogDescription className="sr-only">Preview of {name}</DialogDescription>
        {kind ? (
          <Viewer kind={kind} file={file} bytes={drive.bytes} onClose={props.onClose} onDownload={drive.download} />
        ) : (
          <>
            <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
              <FileIcon name={name} className="ml-1" />
              <p className="min-w-0 flex-1 truncate text-sm font-medium">{name}</p>
              <Button variant="ghost" size="icon-sm" aria-label="Download" onClick={drive.download}>
                <IconDownload />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={props.onClose}>
                <IconX />
              </Button>
            </div>
            {media ? (
              <Media space={props.space} path={props.path} name={name} kind={media} />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <OpenFile
                  read={{ result: QueryResult.of(read), refresh: () => void read.refetch() }}
                  tab={{ path: props.path, preview: false }}
                  onFolder={props.onFolder}
                  onMention={undefined}
                />
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
