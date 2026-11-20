import type { FileSystemEntry } from "@ren/client"
import { Drive } from "@ren/schema/drive"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@ren/ui/dialog"
import { FileName } from "@ren/util/file-name"
import { DriveFileView } from "../../components/file-preview/drive-file-view.js"

export function DriveViewer(props: {
  space: string | undefined
  path: string
  entry: FileSystemEntry | undefined
  onClose: () => void
  onFolder: (folder: string) => void
}) {
  const name = FileName.base(props.path)
  const file = { path: props.path, name, mime: props.entry?.mime ?? Drive.typeOf(name), size: props.entry?.size ?? 0 }
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent
        showCloseButton={false}
        className="flex h-dvh w-full max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:max-w-none data-open:zoom-in-100 data-closed:zoom-out-100"
      >
        <DialogTitle className="sr-only">{name}</DialogTitle>
        <DialogDescription className="sr-only">Preview of {name}</DialogDescription>
        <DriveFileView space={props.space} file={file} onClose={props.onClose} onFolder={props.onFolder} />
      </DialogContent>
    </Dialog>
  )
}
