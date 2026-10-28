import { Icon } from "@ren/ui/icon"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@ren/ui/input-group"
import { Kbd } from "@ren/ui/kbd"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  useSidebar,
} from "@ren/ui/sidebar"
import { Link, useNavigate, useRouterState } from "@tanstack/react-router"
import { useRef, useState } from "react"
import { Search } from "@ren/util/search"
import { Pathname } from "@ren/util/pathname"
import { Keyboard } from "../platform/keyboard.js"
import { SidebarItem, SidebarToggle } from "./app-shell.js"
import { SettingsPages } from "./settings-pages.js"

export function SettingsSidebar() {
  const pathname = useRouterState({ select: (state) => Pathname.trimTrailingSlashes(state.location.pathname) })
  const navigate = useNavigate()
  const sidebar = useSidebar()
  const dismiss = () => sidebar.setOpenMobile(false)
  const search = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState("")
  Keyboard.useKeyDown((event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || Keyboard.isTyping(event)) return
    event.preventDefault()
    search.current?.focus()
  })
  const needle = query.trim().toLowerCase()
  const sections = [
    { label: "Personal", items: SettingsPages.personal },
    { label: "Organization", items: SettingsPages.organization },
  ]
    .map((section) => ({
      label: section.label,
      items: section.items.filter((item) => Search.matches([item.label], needle)),
    }))
    .filter((section) => section.items.length > 0)
  return (
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- shadcn's Sidebar renders a div and passes these to it
    <Sidebar variant="inset" collapsible="icon" role="complementary" aria-label="Navigation">
      <SidebarHeader className="gap-1 px-0 pt-0">
        <div className="mb-1 flex h-9 items-center">
          <SidebarToggle />
        </div>
        <SidebarMenu className="gap-1">
          <SidebarItem label="Back to app" glyph="ArrowLeft" render={<Link to="/" />} />
        </SidebarMenu>
        <InputGroup className="h-9 border-transparent bg-muted group-data-[collapsible=icon]:hidden">
          <InputGroupAddon>
            <Icon glyph="Search" />
          </InputGroupAddon>
          <InputGroupInput
            ref={search}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                const first = sections.at(0)?.items.at(0)
                if (first === undefined) return
                dismiss()
                void navigate({ to: first.to })
              }
              if (event.key === "Escape") {
                setQuery("")
                event.currentTarget.blur()
              }
            }}
            aria-label="Search settings"
            placeholder="Search settings…"
          />
          <InputGroupAddon align="inline-end">
            <Kbd>/</Kbd>
          </InputGroupAddon>
        </InputGroup>
      </SidebarHeader>
      <SidebarContent>
        {sections.map((section) => (
          <SidebarGroup key={section.label} className="px-0 pb-4">
            <SidebarGroupLabel className="mb-1 text-sm text-sidebar-foreground">{section.label}</SidebarGroupLabel>
            <SidebarMenu className="gap-1">
              {section.items.map((item) => (
                <SidebarItem
                  key={item.to}
                  label={item.label}
                  glyph={item.glyph}
                  isActive={pathname === item.to || pathname.startsWith(`${item.to}/`)}
                  render={<Link to={item.to} />}
                />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
        {needle !== "" && sections.length === 0 ? (
          <p className="px-2 text-sm text-sidebar-foreground">No matching settings.</p>
        ) : null}
      </SidebarContent>
    </Sidebar>
  )
}
