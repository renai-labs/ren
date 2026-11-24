import { use, useState } from "react"
import type { SessionMessage } from "@ren/schema/session/message"
import { useNavigate } from "@tanstack/react-router"
import { DriveFilePreview } from "../../components/file-preview/drive-file-view.js"
import { OpenPanel } from "./open-panel.js"

export function useDriveFilePreview(spaceId: string | undefined, file: SessionMessage.DriveFile) {
  const navigate = useNavigate()
  const panel = use(OpenPanel)
  const [open, setOpen] = useState(false)
  if (panel) return { open: () => panel({ kind: "files", path: file.path, drive: { spaceId, file } }), dialog: null }
  return {
    open: () => setOpen(true),
    dialog: (
      <DriveFilePreview
        space={spaceId}
        file={file}
        open={open}
        onOpenChange={setOpen}
        onFolder={(folder) => void navigate({ to: "/drive", search: { space: spaceId, folder } })}
      />
    ),
  }
}
