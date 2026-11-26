import { useEffect, useEffectEvent, useRef, useState, type DragEvent } from "react"
import {
  IconApps,
  IconCube,
  IconEdit,
  IconFile,
  IconFolder,
  IconMessageCircle,
  IconPlus,
  IconSettings,
  IconSubtask,
  IconWebhook,
  IconX,
  type Icon,
} from "@tabler/icons-react"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import { SessionTitle } from "@ren/chat"
import { Button } from "@ren/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@ren/ui/context-menu"
import { useSidebar } from "@ren/ui/sidebar"
import { toast } from "@ren/ui/sonner"
import { cn } from "cn"
import { RouterContext } from "../lib/router-context.js"
import { Tabs } from "../lib/tabs.js"
import { useSpaces } from "../lib/use-spaces.js"
import { Keyboard } from "../platform/keyboard.js"

const middleButton = 1

const arrows: Readonly<Record<string, 1 | -1>> = { ArrowLeft: -1, ArrowRight: 1 }

const pages = [
  { path: "/settings", label: "Settings", icon: IconSettings },
  { path: "/drive", label: "Drive", icon: IconFolder },
  { path: "/tasks", label: "Tasks", icon: IconSubtask },
  { path: "/automations", label: "Automations", icon: IconWebhook },
  { path: "/apps", label: "Apps", icon: IconApps },
  { path: "/marketplace", label: "Apps", icon: IconApps },
  { path: "/spaces", label: "Spaces", icon: IconCube },
] as const satisfies ReadonlyArray<{ path: string; label: string; icon: Icon }>

const newChat = { label: "New chat", icon: IconEdit }

const otherPage = { label: "Page", icon: IconFile }

const pathOf = (href: string, base: string) =>
  (href.startsWith(base) ? href.slice(base.length) : href).split(/[?#]/u)[0] || "/"

function Label(props: { icon: Icon; title: string }) {
  return (
    <>
      <props.icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate group-data-pinned/tab:hidden">{props.title}</span>
    </>
  )
}

function ChatLabel(props: { sessionId: string }) {
  const { api } = RouterContext.useRouterContext()
  const session = useQuery(api.session.get.queryOptions({ idOrSlug: props.sessionId }))
  return <Label icon={IconMessageCircle} title={SessionTitle.display(session.data?.title)} />
}

function SpaceLabel(props: { spaceId: string }) {
  return <Label icon={IconCube} title={useSpaces().spaceName(props.spaceId)} />
}

function Face(props: { href: string; base: string }) {
  const chat = Tabs.chatOf(props.href)
  if (chat) return <ChatLabel sessionId={chat} />
  const path = pathOf(props.href, props.base)
  const space = /^\/spaces\/([^/]+)/u.exec(path)?.[1]
  if (space) return <SpaceLabel spaceId={space} />
  const page =
    path === "/" ? newChat : (pages.find((each) => path === each.path || path.startsWith(`${each.path}/`)) ?? otherPage)
  return <Label icon={page.icon} title={page.label} />
}

const tabClass =
  "group/tab relative flex h-7 w-56 min-w-0 shrink cursor-pointer items-center gap-2 rounded-lg border px-2 text-sm font-medium transition-colors duration-100 select-none data-pinned:w-9 data-pinned:shrink-0 data-pinned:justify-center data-pinned:px-0 data-dragging:opacity-50"

interface Actions {
  readonly select: () => void
  readonly close: () => void
  readonly closeOthers: () => void
  readonly closeRight: () => void
  readonly duplicate: () => void
  readonly pin: () => void
  readonly copyUrl: () => void
}

function TabItem(props: {
  tab: Tabs.Tab
  base: string
  active: boolean
  dragging: boolean
  actions: Actions
  onArrow: (delta: 1 | -1) => void
  onDrag: () => void
  onDragOver: (event: DragEvent<HTMLDivElement>) => void
  onDrop: () => void
  onDragEnd: () => void
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger
        draggable
        data-tab-strip="tab"
        data-active={props.active || undefined}
        data-pinned={props.tab.pinned || undefined}
        data-dragging={props.dragging || undefined}
        className={cn(
          tabClass,
          props.active
            ? "border-border bg-card text-foreground shadow-sm"
            : "border-transparent bg-background text-muted-foreground hover:bg-card hover:text-foreground",
        )}
        onMouseDown={(event) => {
          if (event.button === middleButton) event.preventDefault()
        }}
        onAuxClick={(event) => {
          if (event.button === middleButton) props.actions.close()
        }}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move"
          props.onDrag()
        }}
        onDragOver={props.onDragOver}
        onDrop={(event) => {
          event.preventDefault()
          props.onDrop()
        }}
        onDragEnd={props.onDragEnd}
      >
        {/* oxlint-disable-next-line react/forbid-elements -- a Button would add its padding and fill to the tab */}
        <button
          type="button"
          role="tab"
          aria-selected={props.active}
          tabIndex={props.active ? 0 : -1}
          className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg text-left outline-none group-data-pinned/tab:justify-center focus-visible:ring-3 focus-visible:ring-ring/50"
          onMouseDown={(event) => {
            if (event.button === 0) props.actions.select()
          }}
          onClick={(event) => {
            if (event.detail === 0) props.actions.select()
          }}
          onKeyDown={(event) => {
            const delta = arrows[event.key]
            if (delta === undefined) return
            event.preventDefault()
            props.onArrow(delta)
          }}
        >
          <Face href={Tabs.hrefOf(props.tab)} base={props.base} />
        </button>
        {props.tab.pinned ? null : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close tab"
            className="-mr-1 size-5 shrink-0 rounded-sm text-muted-foreground opacity-0 group-hover/tab:opacity-100 hover:text-foreground focus-visible:opacity-100"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              props.actions.close()
            }}
          >
            <IconX />
          </Button>
        )}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={props.actions.duplicate}>Duplicate tab</ContextMenuItem>
        <ContextMenuItem onClick={props.actions.pin}>{props.tab.pinned ? "Unpin tab" : "Pin tab"}</ContextMenuItem>
        <ContextMenuItem onClick={props.actions.copyUrl}>Copy tab URL</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={props.actions.close}>Close tab</ContextMenuItem>
        <ContextMenuItem onClick={props.actions.closeOthers}>Close other tabs</ContextMenuItem>
        <ContextMenuItem onClick={props.actions.closeRight}>Close tabs to the right</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

const moveOf = (action: { readonly type: string; readonly index?: number }): Tabs.Move => {
  if (action.type === "REPLACE") return "replace"
  if (action.type === "BACK" || (action.type === "GO" && (action.index ?? 0) < 0)) return "back"
  if (action.type === "FORWARD" || (action.type === "GO" && (action.index ?? 0) > 0)) return "forward"
  return "push"
}

function useTabSync(home: string) {
  const router = useRouter()
  const { platform } = RouterContext.useRouterContext()
  const expected = useRef<string>(undefined)
  const show = (state: Tabs.State, how: "push" | "replace") => {
    Tabs.write(platform, state)
    const shown = state.tabs.at(state.active)
    const href = shown && Tabs.hrefOf(shown)
    if (!href || href === router.history.location.href) return
    expected.current = href
    if (how === "push") router.history.push(href)
    else router.history.replace(href)
  }
  const onMove = useEffectEvent((href: string, move: Tabs.Move) =>
    show(Tabs.navigated(Tabs.read(platform), href, move, home), "replace"),
  )
  const history = router.history
  useEffect(() => {
    onMove(history.location.href, "push")
    return history.subscribe((event) => {
      const href = event.location.href
      if (expected.current === href) {
        expected.current = undefined
        return
      }
      onMove(href, moveOf(event.action))
    })
  }, [history])
  return show
}

const digit = (event: KeyboardEvent) => (/^Digit[1-9]$/u.test(event.code) ? Number(event.code.slice(5)) : undefined)

function useTabKeys(handlers: {
  onNew: () => void
  onClose: () => void
  onReopen: () => void
  onPick: (number: number) => void
  onStep: (delta: 1 | -1) => void
}) {
  Keyboard.useKeyDown((event) => {
    if (!event.altKey || event.ctrlKey || event.metaKey) return
    if (
      event.target instanceof HTMLElement &&
      (event.target.isContentEditable || event.target.closest("input, textarea, select"))
    )
      return
    const number = digit(event)
    const actions: Readonly<Record<string, (() => void) | undefined>> = {
      KeyT: event.shiftKey ? handlers.onReopen : handlers.onNew,
      KeyW: event.shiftKey ? undefined : handlers.onClose,
      BracketLeft: () => handlers.onStep(-1),
      BracketRight: () => handlers.onStep(1),
    }
    const run = number === undefined ? actions[event.code] : () => handlers.onPick(number)
    if (!run) return
    event.preventDefault()
    run()
  })
}

export function TabBar() {
  const router = useRouter()
  const { platform } = RouterContext.useRouterContext()
  const sidebar = useSidebar()
  const base = router.options.basepath ?? ""
  const home = `${base}/`
  const state = Tabs.useTabs()
  const show = useTabSync(home)
  const closed = useRef<ReadonlyArray<Tabs.Closed>>([])
  const [dragging, setDragging] = useState<number>()
  const list = useRef<HTMLDivElement>(null)
  const shown = state.tabs.at(state.active)
  const close = (ids: ReadonlySet<string>) => {
    const result = Tabs.close(Tabs.read(platform), ids, home)
    closed.current = [...closed.current, ...result.closed].slice(-20)
    show(result.state, "push")
  }
  const reopen = () => {
    const entry = closed.current.at(-1)
    if (!entry) return
    closed.current = closed.current.slice(0, -1)
    show(Tabs.reopen(Tabs.read(platform), entry), "push")
  }
  const select = (index: number) => show({ ...Tabs.read(platform), active: index }, "push")
  const step = (from: number, delta: number) => (from + delta + state.tabs.length) % state.tabs.length
  const newTab = () => show(Tabs.open(Tabs.read(platform), home, home), "push")
  const copyUrl = (tab: Tabs.Tab) =>
    void navigator.clipboard.writeText(new URL(Tabs.hrefOf(tab), window.location.origin).href).then(
      () => toast.success("Link copied"),
      () => toast.error("Could not copy link"),
    )
  useTabKeys({
    onNew: newTab,
    onClose: () => shown && close(new Set([shown.id])),
    onReopen: reopen,
    onPick: (number) => select(number === 9 ? state.tabs.length - 1 : Math.min(number - 1, state.tabs.length - 1)),
    onStep: (delta) => state.tabs.length > 0 && select(step(state.active, delta)),
  })
  return (
    <header
      data-slot="tab-bar"
      className={cn(
        "fixed top-0 right-0 z-20 hidden h-10 items-center gap-1 pr-2 transition-[left] duration-200 ease-linear md:flex",
        sidebar.state === "expanded"
          ? "left-(--sidebar-width)"
          : "left-[calc(var(--sidebar-width-icon)+(--spacing(6)))]",
      )}
    >
      <div
        ref={list}
        role="tablist"
        aria-label="Tabs"
        className="flex min-w-0 scrollbar-none items-center gap-1.5 overflow-x-auto overscroll-contain"
      >
        {state.tabs.map((tab, index) => (
          <TabItem
            key={tab.id}
            tab={tab}
            base={base}
            active={index === state.active}
            dragging={index === dragging}
            actions={{
              select: () => select(index),
              close: () => close(new Set([tab.id])),
              closeOthers: () => close(Tabs.othersOf(Tabs.read(platform), index)),
              closeRight: () => close(Tabs.rightOf(Tabs.read(platform), index)),
              duplicate: () => show(Tabs.duplicate(Tabs.read(platform), index), "push"),
              pin: () => Tabs.update(platform, (current) => Tabs.pin(current, index)),
              copyUrl: () => copyUrl(tab),
            }}
            onArrow={(delta) => {
              const next = step(index, delta)
              select(next)
              list.current?.querySelectorAll<HTMLElement>("[role=tab]")[next]?.focus()
            }}
            onDrag={() => setDragging(index)}
            onDragOver={(event) => {
              if (dragging !== undefined) event.preventDefault()
            }}
            onDrop={() => {
              if (dragging !== undefined) Tabs.update(platform, (current) => Tabs.move(current, dragging, index))
              setDragging(undefined)
            }}
            onDragEnd={() => setDragging(undefined)}
          />
        ))}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="New tab"
        className="ml-1 shrink-0 text-muted-foreground"
        onClick={newTab}
      >
        <IconPlus />
      </Button>
    </header>
  )
}
