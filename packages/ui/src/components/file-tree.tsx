import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import type { FileTreeSortComparator } from "@pierre/trees"
import { FileTree as FileTreePrimitive, useFileTree } from "@pierre/trees/react"
import { IconChevronDown, IconChevronUp, IconRefresh, IconSearch } from "@tabler/icons-react"
import { cn } from "cn"
import { Button } from "#components/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "#components/input-group"
import { icons } from "../lib/file-icons.js"

type FileStatus = "added" | "deleted" | "modified"

const treeClass =
  "h-full [--trees-accent:var(--muted-foreground)] [--trees-bg:transparent] [--trees-fg-muted:var(--muted-foreground)] [--trees-fg:var(--foreground)]"

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
    icons,
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
  return <FileTreePrimitive data-slot="file-tree" model={tree.model} className={cn(treeClass, className)} />
}

const headerButton = "px-1.5 text-muted-foreground has-data-[icon=inline-start]:pl-1"

type Model = ReturnType<typeof useFileTree>["model"]

const isOpen = (model: Model, path: string) => {
  const item = model.getItem(path)
  return item !== null && "isExpanded" in item && item.isExpanded()
}

const foldersAbove = (path: string) =>
  path
    .split("/")
    .slice(0, -1)
    .map((_, index, parts) => `${parts.slice(0, index + 1).join("/")}/`)

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })

const pinnedFirst =
  (pinned: ReadonlyArray<string>): FileTreeSortComparator =>
  (left, right) => {
    const index = left.segments.findIndex((segment, at) => segment !== right.segments[at])
    const a = left.segments[index]
    const b = right.segments[index]
    if (a === undefined || b === undefined) return left.segments.length - right.segments.length
    const pin = index === 0 ? Number(pinned.includes(b)) - Number(pinned.includes(a)) : 0
    const folder =
      Number(index < right.segments.length - 1 || right.isDirectory) -
      Number(index < left.segments.length - 1 || left.isDirectory)
    return pin || folder || collator.compare(a, b)
  }

const rowPath = (event: Event) =>
  event
    .composedPath()
    .flatMap((node) => (node instanceof Element ? (node.getAttribute("data-item-path") ?? []) : []))
    .at(0)

function FileExplorer(props: {
  paths: ReadonlyArray<string>
  loaded: ReadonlyArray<string>
  gitStatus: ReadonlyArray<{ readonly path: string; readonly status: FileStatus }>
  selected: string | undefined
  dragType: string
  onSelect: (path: string) => void
  onPin: (path: string) => void
  onExpand: (folder: string) => void
  onQuery: (query: string) => void
  onRefresh: () => void
  pinned?: ReadonlyArray<string> | undefined
  notice?: ReactNode
  // ast-grep-ignore: no-render-props -- the tree hands back the row that was right-clicked
  renderMenu: (item: { readonly path: string; readonly kind: "file" | "directory" }, close: () => void) => ReactNode
  className?: string
}) {
  const [query, setQuery] = useState("")
  const latest = useRef(props)
  const dragging = useRef(false)
  const revealing = useRef(false)
  const requested = useRef(new Set<string>())
  useEffect(() => {
    latest.current = props
  })
  const tree = useFileTree({
    paths: props.paths,
    icons,
    density: "compact",
    initialExpansion: "closed",
    ...(props.pinned?.length && { sort: pinnedFirst(props.pinned) }),
    fileTreeSearchMode: "hide-non-matches",
    search: false,
    dragAndDrop: { canDrop: () => false },
    initialSelectedPaths: props.selected ? [props.selected] : [],
    gitStatus: props.gitStatus,
    onSelectionChange: (next) => {
      const path = next.at(0)
      if (path && !path.endsWith("/") && !dragging.current && !revealing.current) latest.current.onSelect(path)
    },
  })
  const model = tree.model
  const key = props.paths.join("\n")
  const folders = useMemo(() => props.paths.filter((path) => path.endsWith("/")), [props.paths])
  useEffect(() => {
    const paths = latest.current.paths
    const search = model.getSearchValue()
    model.resetPaths(paths, {
      initialExpandedPaths: paths.filter((path) => path.endsWith("/") && isOpen(model, path)),
    })
    if (!search) return
    model.setSearch(null)
    model.setSearch(search)
  }, [model, key])
  const statusKey = props.gitStatus.map((file) => `${file.status}\0${file.path}`).join("\0")
  useEffect(() => {
    model.setGitStatus(latest.current.gitStatus)
  }, [model, statusKey])
  useEffect(() => {
    const loaded = new Set(props.loaded)
    const pending = new Set(folders.filter((path) => !loaded.has(path) && !requested.current.has(path)))
    const expand = () => {
      for (const path of pending) {
        if (!isOpen(model, path)) continue
        pending.delete(path)
        requested.current.add(path)
        latest.current.onExpand(path)
      }
    }
    expand()
    return model.subscribe(expand)
  }, [model, folders, props.loaded])
  const selected = props.selected
  useEffect(() => {
    const item = selected ? model.getItem(selected) : null
    if (!selected || !item || item.isSelected()) return
    revealing.current = true
    for (const path of foldersAbove(selected)) {
      const folder = model.getItem(path)
      if (folder && "expand" in folder) folder.expand()
    }
    for (const path of model.getSelectedPaths()) model.getItem(path)?.deselect()
    item.select()
    model.scrollToPath(selected, { offset: "center" })
    revealing.current = false
  }, [model, selected, key])
  const change = (value: string) => {
    setQuery(value)
    model.setSearch(value.trim() || null)
    props.onQuery(value.trim())
  }
  const each = (paths: ReadonlyArray<string>, action: "expand" | "collapse") => {
    for (const path of paths) {
      const item = model.getItem(path)
      if (item && "expand" in item) item[action]()
    }
  }
  return (
    <div
      data-slot="file-explorer"
      className={cn("flex min-h-0 flex-1 flex-col", props.className)}
      onDragStartCapture={(event) => {
        const path = rowPath(event.nativeEvent)
        if (!path || path.endsWith("/")) return
        dragging.current = true
        event.dataTransfer.setData(props.dragType, path)
      }}
      onDoubleClick={(event) => {
        const path = rowPath(event.nativeEvent)
        if (path && !path.endsWith("/")) props.onPin(path)
      }}
      onDragEnd={() => {
        if (!dragging.current) return
        dragging.current = false
        for (const path of model.getSelectedPaths()) model.getItem(path)?.deselect()
      }}
    >
      <div className="flex shrink-0 flex-col gap-1.5 px-1.5 pt-2 pb-1">
        <InputGroup className="h-7">
          <InputGroupAddon>
            <IconSearch />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={query}
            placeholder="Search files"
            aria-label="Search files"
            onChange={(event) => change(event.target.value)}
          />
        </InputGroup>
        <div className="flex min-w-0 items-center">
          <Button variant="ghost" size="sm" className={headerButton} onClick={() => each(folders, "collapse")}>
            <IconChevronUp data-icon="inline-start" />
            Collapse all
          </Button>
          <Button variant="ghost" size="sm" className={headerButton} onClick={() => each(props.loaded, "expand")}>
            <IconChevronDown data-icon="inline-start" />
            Expand loaded
          </Button>
          <Button variant="ghost" size="sm" className={cn(headerButton, "ml-auto")} onClick={props.onRefresh}>
            <IconRefresh data-icon="inline-start" />
            Refresh
          </Button>
        </div>
      </div>
      {props.notice}
      <FileTreePrimitive
        data-slot="file-tree"
        model={model}
        aria-label="Files"
        className={cn(
          treeClass,
          "min-h-0 flex-1 [--trees-border-radius-override:var(--radius-md)] [--trees-selected-bg-override:var(--secondary)]",
        )}
        // ast-grep-ignore: no-render-props -- @pierre/trees takes its context menu as a function
        renderContextMenu={(item, context) => (
          <div
            role="menu"
            data-file-tree-context-menu-root="true"
            className="flex min-w-40 flex-col rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-overlay"
          >
            {props.renderMenu(item, context.close)}
          </div>
        )}
      />
    </div>
  )
}

export { FileExplorer, FileTree }
