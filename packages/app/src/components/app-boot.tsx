import { LogomarkShape } from "@ren/util/logomark-shape"
import { useLocation } from "@tanstack/react-router"
import type { CSSProperties } from "react"
import { Preference } from "../lib/preference.js"
import { SidebarPreferences } from "../lib/sidebar-preferences.js"
import { DarkUi } from "../lib/dark-ui.js"

const outsideShell =
  /^\/(?:login|signup|forgot-password|reset-password|verify-email|consent|invites|join|organizations)(?:\/|$)/u

function LoadingMark() {
  return (
    <svg viewBox={LogomarkShape.viewBox} fill="none" aria-hidden="true" className="h-9 w-auto text-foreground/10">
      {LogomarkShape.paths.map((d) => (
        <path key={d} d={d} fill="currentColor" />
      ))}
      <path d={LogomarkShape.paths[2]} fill="currentColor" className="animate-logo-progress text-muted-foreground" />
    </svg>
  )
}

function ShellBoot() {
  const open = Preference.usePreference(SidebarPreferences.open)
  const width = Preference.usePreference(SidebarPreferences.width)
  return (
    <output
      aria-label="Loading Ren…"
      data-slot="app-boot"
      data-sidebar-state={open ? "expanded" : "collapsed"}
      style={width === null ? undefined : ({ "--boot-sidebar": `${width}px` } as CSSProperties)}
      className="flex min-h-svh"
    >
      <span data-slot="app-boot-sidebar" aria-hidden />
      <span data-slot="app-boot-panel" className="flex items-center justify-center">
        <LoadingMark />
      </span>
    </output>
  )
}

export function AppBoot() {
  const deep = DarkUi.useDarkUi()
  const path = useLocation({ select: (location) => location.pathname })
  if (deep && !outsideShell.test(path)) return <ShellBoot />
  return (
    <output aria-label="Loading Ren…" className="flex min-h-svh items-center justify-center bg-background">
      <LoadingMark />
    </output>
  )
}
