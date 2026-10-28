import { Icon } from "@ren/ui/icon"
import type { Glyph } from "@ren/ui/icon"
import {
  SidebarInset,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@ren/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { Schema } from "effect"
import { useState } from "react"
import type { ReactElement, ReactNode } from "react"
import { Preference } from "../lib/preference.js"
import { Platform } from "../platform/platform.js"
import { Viewport } from "../platform/viewport.js"

const sidebarPreference = Preference.make("sidebar.v1", Schema.Literals(["expanded", "collapsed"]), "expanded")

export function AppShell(props: { sidebar: ReactNode; children: ReactNode }) {
  const platform = Platform.usePlatform()
  const [open, setOpen] = useState(() => sidebarPreference.read(platform.storage) === "expanded")
  return (
    <SidebarProvider
      open={open}
      onOpenChange={(next) => {
        sidebarPreference.write(platform.storage, next ? "expanded" : "collapsed")
        setOpen(next)
      }}
      className="h-svh min-h-0 overflow-hidden"
    >
      {props.sidebar}
      <SidebarInset className="h-svh min-w-0 overflow-hidden md:h-[calc(100svh-var(--ren-spacing-4))] md:shadow-none md:inset-ring md:inset-ring-border">
        <span className="absolute top-2 left-2 z-20 md:hidden">
          <SidebarTrigger aria-label="Open navigation" className="text-muted-foreground" />
        </span>
        <div
          data-slot="page-scroll"
          className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"
        >
          {props.children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

export function SidebarToggle() {
  const sidebar = useSidebar()
  const desktop = sidebar.state === "collapsed" ? "Expand sidebar" : "Collapse sidebar"
  const label = sidebar.isMobile ? "Close navigation" : desktop
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarTrigger aria-label={label} aria-keyshortcuts="Meta+B Control+B" className="text-muted-foreground" />
        }
      />
      <TooltipContent side="right">{`${label} (${Viewport.shortcut("B")})`}</TooltipContent>
    </Tooltip>
  )
}

export function SidebarItem(props: {
  label: string
  glyph: Glyph
  isActive?: boolean
  render?: ReactElement
  shortcut?: string
  onClick?: () => void
  trailing?: ReactNode
}) {
  const sidebar = useSidebar()
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        className="h-9"
        tooltip={props.label}
        isActive={props.isActive ?? false}
        aria-keyshortcuts={props.shortcut}
        render={props.render}
        onClick={() => {
          sidebar.setOpenMobile(false)
          props.onClick?.()
        }}
      >
        <Icon glyph={props.glyph} />
        <span>{props.label}</span>
      </SidebarMenuButton>
      {props.trailing}
    </SidebarMenuItem>
  )
}
