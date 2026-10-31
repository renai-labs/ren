import { useEffect } from "react"
import { FileTree as FileTreePrimitive, useFileTree } from "@pierre/trees/react"
import { cn } from "cn"

type FileStatus = "added" | "deleted" | "modified"

function FileTree({
  files,
  selected,
  onSelect,
  className,
}: {
  files: ReadonlyArray<{ readonly path: string; readonly status: FileStatus }>
  selected: string | undefined
  onSelect: (path: string) => void
  className?: string
}) {
  const paths = files.map((file) => file.path)
  const tree = useFileTree({
    paths,
    initialExpansion: "open",
    initialSelectedPaths: selected ? [selected] : [],
    gitStatus: files.map((file) => ({ path: file.path, status: file.status })),
    onSelectionChange: (next) => {
      const path = next.at(0)
      if (path && paths.includes(path)) onSelect(path)
    },
  })
  const key = paths.join("\n")
  useEffect(() => {
    tree.model.resetPaths(key ? key.split("\n") : [])
  }, [tree.model, key])
  return (
    <FileTreePrimitive
      data-slot="file-tree"
      model={tree.model}
      className={cn(
        "h-full [--trees-accent:var(--muted-foreground)] [--trees-bg:transparent] [--trees-fg-muted:var(--muted-foreground)] [--trees-fg:var(--foreground)] [--trees-file-icon-color:var(--muted-foreground)]",
        className,
      )}
    />
  )
}

export { FileTree }
