export * as ApplicationShell from "./application-shell.js"

import { Drawer } from "@base-ui/react/drawer"
import { useRender } from "@base-ui/react/use-render"
import { createContext, use, useEffect, useEffectEvent, useState } from "react"
import type { ReactElement, ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { Button } from "./button.js"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card.js"
import { Icon } from "./icon.js"
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js"

export type NavigationState = "expanded" | "collapsed"

type Navigation = { collapsed: boolean; dismiss: () => void }

const NavigationContext = createContext<Navigation | null>(null)

export function useNavigation() {
  const navigation = use(NavigationContext)
  if (navigation === null) throw new Error("ApplicationShell.useNavigation must be used within ApplicationShell.Root")
  return navigation
}

export type RootProps = {
  mobile: boolean
  subscribeKeyDown?: (listener: (event: KeyboardEvent) => void) => () => void
  navigationHeader?: ReactNode
  navigation: ReactNode
  navigationFooter?: ReactNode
  toggleShortcut?: string
  state: NavigationState
  onStateChange: (state: NavigationState) => void
  defaultNavigationOpen?: boolean
  notificationRegion?: ReactNode
  children: ReactNode
}

const subscribeWindow = (listener: (event: KeyboardEvent) => void) => {
  window.addEventListener("keydown", listener)
  return () => window.removeEventListener("keydown", listener)
}

export function Root(props: RootProps) {
  const [open, setOpen] = useState(props.defaultNavigationOpen ?? false)
  const toggle = () => {
    if (props.mobile) setOpen((current) => !current)
    else props.onStateChange(props.state === "expanded" ? "collapsed" : "expanded")
  }
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key.toLowerCase() !== "b" || !(event.metaKey || event.ctrlKey)) return
    event.preventDefault()
    toggle()
  })
  const subscribe = props.subscribeKeyDown ?? subscribeWindow
  useEffect(() => subscribe((event) => onKeyDown(event)), [subscribe])

  const shell = (
    <div data-slot="application-shell" className="flex h-dvh min-h-0 w-full overflow-hidden bg-background-tertiary">
      {props.mobile ? (
        <Drawer.Portal>
          <Drawer.Backdrop className="fixed inset-0 z-50 bg-overlay-primary transition-extended data-ending-style:opacity-0 data-starting-style:opacity-0" />
          <Drawer.Viewport className="fixed inset-0 z-50">
            <Drawer.Popup
              data-slot="navigation-panel"
              data-state="expanded"
              aria-label="Navigation"
              // oxlint-disable-next-line ren/require-companion-class -- the popup takes focus only as a fallback container; its controls draw their own rings
              className="fixed inset-y-0 left-0 z-50 flex w-sidebar max-w-[calc(100vw-var(--ren-spacing-12))] translate-x-(--drawer-swipe-movement-x) flex-col bg-background-tertiary transition-extended outline-none data-ending-style:-translate-x-full data-starting-style:-translate-x-full data-swiping:transition-none"
            >
              <Drawer.Title className="sr-only">Navigation</Drawer.Title>
              <NavigationContext value={{ collapsed: false, dismiss: () => setOpen(false) }}>
                <Panel {...props} toggle={toggle} />
              </NavigationContext>
            </Drawer.Popup>
          </Drawer.Viewport>
        </Drawer.Portal>
      ) : (
        <aside
          data-slot="navigation-panel"
          data-state={props.state}
          aria-label="Navigation"
          className={composeClasses(
            "group/navigation flex h-full shrink-0 flex-col overflow-hidden transition-extended",
            props.state === "expanded" ? "w-sidebar" : "w-12",
          )}
        >
          <NavigationContext value={{ collapsed: props.state === "collapsed", dismiss: () => undefined }}>
            <Panel {...props} toggle={toggle} />
          </NavigationContext>
        </aside>
      )}
      <ContentRegion {...props} />
    </div>
  )

  if (!props.mobile) return shell
  return (
    <Drawer.Root open={open} onOpenChange={(next) => setOpen(next)} swipeDirection="left">
      {shell}
    </Drawer.Root>
  )
}

function ContentRegion(props: RootProps) {
  return (
    <main
      data-slot="content-region"
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:p-2 md:pl-0"
    >
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background-primary md:rounded-container">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-15 hidden rounded-container border border-border-primary md:block"
        />
        {props.mobile ? (
          <span className="absolute top-2 left-2 z-20">
            <Drawer.Trigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label="Open navigation" className="text-muted-foreground">
                  <Icon glyph="PanelLeft" />
                </Button>
              }
            />
          </span>
        ) : null}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">{props.children}</div>
      </div>
      {props.notificationRegion}
    </main>
  )
}

function Panel(props: RootProps & { toggle: () => void }) {
  const desktopLabel = props.state === "collapsed" ? "Expand sidebar" : "Collapse sidebar"
  const label = props.mobile ? "Close navigation" : desktopLabel
  const button = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      onClick={props.mobile ? undefined : props.toggle}
      aria-keyshortcuts="Meta+B Control+B"
      className="text-muted-foreground"
    >
      <Icon glyph="PanelLeft" />
    </Button>
  )
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 py-2">
      <div className="flex shrink-0 items-center gap-1 px-2">
        {props.navigationHeader}
        <Tooltip>
          <TooltipTrigger render={props.mobile ? <Drawer.Close render={button} /> : button} />
          <TooltipContent side="right">
            {props.toggleShortcut ? `${label} (${props.toggleShortcut})` : label}
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">{props.navigation}</div>
      {props.navigationFooter ? (
        <div className="flex min-h-10 shrink-0 flex-col justify-center px-2">{props.navigationFooter}</div>
      ) : null}
    </div>
  )
}

export type NavigationSectionProps = {
  title?: ReactNode
  actions?: ReactNode
  scrolling?: "none" | "contained"
  collapsedVisibility?: "visible" | "hidden"
  children: ReactNode
}

export function NavigationSection(props: NavigationSectionProps) {
  return (
    <section
      className={composeClasses(
        "flex min-w-0 flex-col gap-1 px-2",
        props.scrolling === "contained" && "min-h-0 flex-1",
        props.collapsedVisibility === "hidden" && "group-data-[state=collapsed]/navigation:hidden",
      )}
    >
      {props.title ? (
        <header className="flex h-8 shrink-0 items-center gap-1 pr-1 pl-2 group-data-[state=collapsed]/navigation:hidden">
          <h2 className="flex-1 truncate text-sm font-medium text-text-secondary">{props.title}</h2>
          {props.actions}
        </header>
      ) : null}
      <ul
        className={composeClasses(
          "flex min-w-0 flex-col gap-1",
          props.scrolling === "contained" && "min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2",
        )}
      >
        {props.children}
      </ul>
    </section>
  )
}

export type NavigationItemProps = {
  render?: ReactElement
  icon?: ReactNode
  label: ReactNode
  trailing?: ReactNode
  preview?: ReactNode
  onPreviewChange?: (open: boolean) => void
  current?: boolean
  highlighted?: boolean
  shortcut?: string
  onActivate?: () => void
}

export function NavigationItem(props: NavigationItemProps) {
  const navigation = useNavigation()
  const element = useRender({
    defaultTagName: "button",
    render: props.render,
    props: {
      type: props.render === undefined ? "button" : undefined,
      "aria-current": props.current ? "page" : undefined,
      "aria-label": navigation.collapsed && typeof props.label === "string" ? props.label : undefined,
      "aria-keyshortcuts": props.shortcut,
      className:
        "flex h-9 w-full min-w-0 items-center gap-2 rounded-control px-2 text-start text-sm text-text-secondary transition-standard outline-none group-data-[state=collapsed]/navigation:justify-center group-data-[state=collapsed]/navigation:px-0 hover:bg-fill-secondary hover:text-text-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-primary aria-[current=page]:bg-fill-secondary aria-[current=page]:font-medium aria-[current=page]:text-text-primary [&_svg]:size-4 [&_svg]:shrink-0",
      onClick: () => {
        props.onActivate?.()
        navigation.dismiss()
      },
      children: (
        <>
          {props.icon}
          <span className="min-w-0 flex-1 truncate group-data-[state=collapsed]/navigation:hidden">{props.label}</span>
          {props.trailing ? (
            <span className="flex shrink-0 items-center gap-1 text-xs text-text-secondary group-data-[state=collapsed]/navigation:hidden">
              {props.trailing}
            </span>
          ) : null}
        </>
      ),
    },
  })
  return (
    <li
      className={composeClasses(
        "group/navigation-item relative flex min-w-0 items-center",
        props.highlighted && "rounded-control bg-fill-secondary",
      )}
    >
      {navigation.collapsed && typeof props.label === "string" ? (
        <Tooltip>
          <TooltipTrigger render={element} />
          <TooltipContent side="right">{props.label}</TooltipContent>
        </Tooltip>
      ) : (
        <Preview {...props} element={element} />
      )}
    </li>
  )
}

function Preview(props: NavigationItemProps & { element: ReactElement }) {
  if (!props.preview) return props.element
  return (
    <HoverCard onOpenChange={(open) => props.onPreviewChange?.(open)}>
      <HoverCardTrigger render={props.element} />
      <HoverCardContent side="right" align="start" sideOffset={8} className="w-72 p-1">
        {props.preview}
      </HoverCardContent>
    </HoverCard>
  )
}
