import type { FileSystemEntry } from "@ren/client"
import { Drive } from "@ren/schema/drive"
import { Button } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@ren/ui/dialog"
import { FileIcon } from "@ren/ui/file-icon"
import { formatDate } from "@ren/ui/time"
import { FileName } from "@ren/util/file-name"
import { IconCalendar, IconFolder, IconRuler2 } from "@tabler/icons-react"
import { DriveFileView } from "../../components/file-preview/drive-file-view.js"
import { formatBytes } from "../../lib/format.js"
import { DarkUi } from "../../lib/dark-ui.js"

function Facts(props: { path: string; entry: FileSystemEntry | undefined; onFolder: (folder: string) => void }) {
  const name = FileName.base(props.path)
  const folder = props.path.slice(0, props.path.lastIndexOf("/") + 1)
  const extension = name.includes(".") ? (name.split(".").at(-1) ?? "").toUpperCase() : ""
  const modified = props.entry?.modifiedAt
  return (
    <aside aria-label="File properties" data-slot="viewer-aside">
      <section>
        <h2>Properties</h2>
        <p data-property="">
          <FileIcon name={name} mime={props.entry?.mime} />
          {extension ? `${extension} file` : "File"}
        </p>
        {props.entry?.size === undefined ? null : (
          <p data-property="">
            <IconRuler2 />
            {formatBytes(props.entry.size)}
          </p>
        )}
        {modified ? (
          <p data-property="">
            <IconCalendar />
            {formatDate(modified)}
          </p>
        ) : null}
      </section>
      <section>
        <h2>Location</h2>
        <Button variant="ghost" onClick={() => props.onFolder(folder)}>
          <IconFolder />
          <span className="truncate">{folder ? FileName.base(folder) : "Drive"}</span>
        </Button>
      </section>
    </aside>
  )
}

export function DriveViewer(props: {
  space: string | undefined
  path: string
  entry: FileSystemEntry | undefined
  onClose: () => void
  onFolder: (folder: string) => void
}) {
  const deep = DarkUi.useDarkUi()
  const name = FileName.base(props.path)
  const file = { path: props.path, name, mime: props.entry?.mime ?? Drive.typeOf(name), size: props.entry?.size ?? 0 }
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent
        data-slot-viewer="drive"
        showCloseButton={false}
        className="flex h-dvh w-full max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:max-w-none data-open:zoom-in-100 data-closed:zoom-out-100"
      >
        <DialogTitle className="sr-only">{name}</DialogTitle>
        <DialogDescription className="sr-only">Preview of {name}</DialogDescription>
        <DriveFileView
          space={props.space}
          file={file}
          aside={deep ? <Facts path={props.path} entry={props.entry} onFolder={props.onFolder} /> : undefined}
          onClose={props.onClose}
          onFolder={props.onFolder}
        />
      </DialogContent>
    </Dialog>
  )
}
