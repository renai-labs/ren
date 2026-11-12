import { use } from "react"
import { FileChip } from "@ren/ui/file-chip"
import { toast } from "@ren/ui/sonner"
import { WorkspaceFile } from "./workspace-file.js"

export function WorkspaceFileChip(props: { path: string; line?: number | undefined }) {
  const open = use(WorkspaceFile)
  return (
    <FileChip
      path={props.path}
      line={props.line}
      onOpen={open && !props.path.startsWith("/") ? () => open({ path: props.path, line: props.line }) : undefined}
      onCopy={() =>
        void navigator.clipboard.writeText(props.path).then(
          () => toast.success("Copied path"),
          () => toast.error("Could not copy the path"),
        )
      }
    />
  )
}
