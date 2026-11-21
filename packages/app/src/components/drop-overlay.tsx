import { IconUpload } from "@tabler/icons-react"
import { FileDrop } from "../platform/file-drop.js"

export function DropOverlay(props: { title: string; detail: string; onFiles: (files: ReadonlyArray<File>) => void }) {
  const dragging = FileDrop.use(props.onFiles)
  if (!dragging) return null
  return (
    <div className="pointer-events-none fixed inset-2 z-50 flex animate-in items-center justify-center rounded-2xl border-2 border-dashed border-ring/60 bg-background/80 backdrop-blur-sm duration-150 ease-out fade-in-0 motion-reduce:animate-none">
      <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
        <IconUpload className="size-6 text-foreground" />
        <span className="text-foreground">{props.title}</span>
        <span className="text-xs">{props.detail}</span>
      </div>
    </div>
  )
}
