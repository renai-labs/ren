import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { FileTree as FileTreePrimitive, useFileTree } from "@pierre/trees/react"
import { IconFoldUp, IconRefresh, IconSearch } from "@tabler/icons-react"
import { cn } from "cn"
import { Button } from "#components/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "#components/input-group"
import { Toggle } from "#components/toggle"
import { Tooltip, TooltipContent, TooltipTrigger } from "#components/tooltip"
import { icons } from "../lib/file-icons.js"

type FileStatus = "added" | "deleted" | "modified"

const treeClass =
  "h-full [--trees-accent:var(--muted-foreground)] [--trees-bg:var(--card)] [--trees-fg-muted:var(--muted-foreground)] [--trees-fg:var(--foreground)]"

const focusCSS = `
[data-item-focused='true']::before {
  outline: none !important;
}
`

const explorerCSS = `
:host {
  --trees-font-family-override: var(--font-sans);
  --trees-font-size-override: 13px;
  --trees-padding-inline-override: 8px;
  --trees-item-padding-x-override: 3px;
  --trees-item-margin-x-override: 0px;
  --trees-item-row-gap-override: 4px;
  --trees-level-gap-override: 5px;
  --trees-icon-width-override: 14px;
  --trees-icon-nudge-override: 0px;
  --trees-border-radius-override: 6px;
  --trees-git-lane-width-override: 10px;
  --trees-action-lane-width-override: 14px;
  --trees-scrollbar-gutter-override: 6px;
  --trees-theme-sidebar-bg: transparent;
  --trees-theme-sidebar-fg: var(--foreground);
  --trees-theme-list-hover-bg: var(--muted);
  --trees-theme-list-active-selection-bg: var(--secondary);
  --trees-theme-list-active-selection-fg: var(--foreground);
  --trees-theme-focus-ring: var(--ring);
  --trees-status-added-override: var(--chart-2);
  --trees-status-untracked-override: var(--chart-2);
  --trees-status-modified-override: var(--chart-3);
  --trees-status-renamed-override: var(--chart-3);
  --trees-status-deleted-override: var(--chart-4);
  --trees-git-added-color-override: color-mix(in srgb, var(--chart-2) 60%, transparent);
  --trees-git-modified-color-override: color-mix(in srgb, var(--chart-3) 60%, transparent);
  --trees-git-deleted-color-override: color-mix(in srgb, var(--chart-4) 60%, transparent);
}
[data-item-git-status] > [data-item-section='content'] {
  color: var(--trees-theme-sidebar-fg) !important;
}
${focusCSS}
[data-item-section='git'] {
  width: 14px;
  margin-inline-end: 2px;
}
[data-item-section='git'] [data-icon-name='file-tree-icon-dot'] {
  transform: none;
}
`

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
    unsafeCSS: focusCSS,
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

function TreeAction(props: { label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={props.label}
            className="text-muted-foreground"
            onClick={props.onClick}
          />
        }
      >
        {props.icon}
      </TooltipTrigger>
      <TooltipContent side="bottom">{props.label}</TooltipContent>
    </Tooltip>
  )
}

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

const hoverDelay = 150

const rowPath = (event: Event) =>
  event
    .composedPath()
    .flatMap((node) => (node instanceof Element ? (node.getAttribute("data-item-path") ?? []) : []))
    .at(0)

function FileExplorer(props: {
  paths: ReadonlyArray<string>
  opened: ReadonlyArray<string>
  gitStatus: ReadonlyArray<{ readonly path: string; readonly status: FileStatus }>
  selected: string | undefined
  dragType: string
  base: string
  onSelect: (path: string) => void
  onPin: (path: string) => void
  onExpand: (folder: string) => void
  onCollapse: (folder: string) => void
  onHover: (path: string) => void
  onQuery: (query: string) => void
  onRefresh: () => void
  header?: ReactNode
  tools?: ReactNode
  actions?: ReactNode
  notice?: ReactNode
  // ast-grep-ignore: no-render-props -- the tree hands back the row that was right-clicked
  renderMenu: (item: { readonly path: string; readonly kind: "file" | "directory" }, close: () => void) => ReactNode
  className?: string
}) {
  const [query, setQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const focusSearch = useRef(false)
  const latest = useRef(props)
  const dragging = useRef(false)
  const revealing = useRef(false)
  const reported = useRef(new Set<string>())
  const shown = useRef(new Set(props.paths))
  const hovered = useRef<{ path?: string | undefined; timer?: number | undefined }>({})
  useEffect(() => {
    latest.current = props
  })
  useEffect(() => () => clearTimeout(hovered.current.timer), [])
  const tree = useFileTree({
    paths: props.paths,
    icons,
    density: 0.8,
    itemHeight: 24,
    unsafeCSS: explorerCSS,
    initialExpansion: "closed",
    initialExpandedPaths: props.opened.filter((path) => props.paths.includes(path)),
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
    const next = new Set(paths)
    const removed = [...shown.current].some((path) => !next.has(path))
    shown.current = next
    const search = model.getSearchValue()
    if (removed)
      model.resetPaths(paths, {
        initialExpandedPaths: paths.filter((path) => path.endsWith("/") && isOpen(model, path)),
      })
    else
      model.batch(paths.filter((path) => model.getItem(path) === null).map((path) => ({ type: "add" as const, path })))
    if (!search) return
    model.setSearch(null)
    model.setSearch(search)
  }, [model, key])
  const statusKey = props.gitStatus.map((file) => `${file.status}\0${file.path}`).join("\0")
  useEffect(() => {
    model.setGitStatus(latest.current.gitStatus)
  }, [model, statusKey])
  useEffect(() => {
    const report = () => {
      for (const path of folders) {
        const open = isOpen(model, path)
        if (open === reported.current.has(path)) continue
        if (open) {
          reported.current.add(path)
          latest.current.onExpand(path)
        } else {
          reported.current.delete(path)
          latest.current.onCollapse(path)
        }
      }
    }
    report()
    return model.subscribe(report)
  }, [model, folders])
  const selected = props.selected
  const revealed = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!selected) revealed.current = undefined
    const item = selected ? model.getItem(selected) : null
    if (!selected || !item || revealed.current === selected) return
    revealed.current = selected
    if (item.isSelected()) return
    revealing.current = true
    for (const path of foldersAbove(selected)) {
      const folder = model.getItem(path)
      if (folder && "expand" in folder) folder.expand()
    }
    for (const path of model.getSelectedPaths()) model.getItem(path)?.deselect()
    item.select()
    model.scrollToPath(selected, { offset: "nearest" })
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
        event.dataTransfer.setData(props.dragType, props.base + path)
      }}
      onPointerOver={(event) => {
        const path = rowPath(event.nativeEvent)
        const file = path && !path.endsWith("/") ? path : undefined
        if (file === hovered.current.path) return
        clearTimeout(hovered.current.timer)
        hovered.current = {
          path: file,
          timer: file ? window.setTimeout(() => latest.current.onHover(file), hoverDelay) : undefined,
        }
      }}
      onPointerLeave={() => {
        clearTimeout(hovered.current.timer)
        hovered.current = {}
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
      <div className="flex h-9 shrink-0 items-center gap-0.5 px-1.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                size="sm"
                aria-label="Search files"
                pressed={searching}
                onPressedChange={(next: boolean) => {
                  focusSearch.current = next
                  setSearching(next)
                  if (!next) change("")
                }}
                className="text-muted-foreground"
              />
            }
          >
            <IconSearch />
          </TooltipTrigger>
          <TooltipContent side="bottom">Search files</TooltipContent>
        </Tooltip>
        {props.tools}
        <TreeAction label="Collapse all" icon={<IconFoldUp />} onClick={() => each(folders, "collapse")} />
        <TreeAction label="Refresh" icon={<IconRefresh />} onClick={props.onRefresh} />
        <div className="ml-auto flex items-center">{props.actions}</div>
      </div>
      {searching ? (
        <div className="shrink-0 px-2 pb-1.5">
          <InputGroup className="h-7">
            <InputGroupAddon>
              <IconSearch />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              ref={(node) => {
                if (!node || !focusSearch.current) return
                focusSearch.current = false
                node.focus()
              }}
              value={query}
              placeholder="Search files"
              aria-label="Search files"
              onChange={(event) => change(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return
                setSearching(false)
                change("")
              }}
            />
          </InputGroup>
        </div>
      ) : null}
      {props.header ? <div className="flex shrink-0 items-center px-2 pb-1">{props.header}</div> : null}
      {props.notice}
      <FileTreePrimitive
        data-slot="file-tree"
        model={model}
        aria-label="Files"
        className={cn(treeClass, "min-h-0 flex-1")}
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
