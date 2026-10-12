import { ApplicationShell } from "@ren/ui/application-shell"
import { Icon } from "@ren/ui/icon"
import { KeyboardKey } from "@ren/ui/keyboard-key"
import { StateMessage } from "@ren/ui/state-message"
import { TextField } from "@ren/ui/text-field"
import { Link, useNavigate, useRouterState } from "@tanstack/react-router"
import { useRef, useState } from "react"
import { Keyboard } from "../platform/keyboard.js"
import { SettingsPages } from "./settings-pages.js"

export function SettingsSidebar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname.replace(/\/+$/, "") })
  const navigate = useNavigate()
  const navigation = ApplicationShell.useNavigation()
  const search = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState("")
  Keyboard.useKeyDown((event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || Keyboard.isTyping(event)) return
    event.preventDefault()
    search.current?.focus()
  })
  const needle = query.trim().toLowerCase()
  const matching = (items: ReadonlyArray<SettingsPages.Page>) =>
    items.filter((item) => item.label.toLowerCase().includes(needle))
  const visiblePersonal = matching(SettingsPages.personal)
  const visibleOrganization = matching(SettingsPages.organization)
  const item = (entry: SettingsPages.Page) => (
    <ApplicationShell.NavigationItem
      key={entry.to}
      current={pathname === entry.to || pathname.startsWith(`${entry.to}/`)}
      icon={<Icon glyph={entry.glyph} />}
      label={entry.label}
      render={<Link to={entry.to} />}
    />
  )
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <ApplicationShell.NavigationSection>
        <ApplicationShell.NavigationItem
          icon={<Icon glyph="ArrowLeft" />}
          label="Back to app"
          render={<Link to="/sessions" />}
        />
        <li>
          <TextField
            ref={search}
            appearance="filled"
            aria-label="Search settings"
            placeholder="Search settings…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                const first = visiblePersonal[0] ?? visibleOrganization[0]
                if (first === undefined) return
                navigation.dismiss()
                void navigate({ to: first.to })
              }
              if (event.key === "Escape") {
                setQuery("")
                event.currentTarget.blur()
              }
            }}
            leading={<Icon glyph="Search" />}
            trailing={<KeyboardKey>/</KeyboardKey>}
          />
        </li>
      </ApplicationShell.NavigationSection>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain pb-12">
        {visiblePersonal.length > 0 ? (
          <ApplicationShell.NavigationSection title="Personal">
            {visiblePersonal.map(item)}
          </ApplicationShell.NavigationSection>
        ) : null}
        {visibleOrganization.length > 0 ? (
          <ApplicationShell.NavigationSection title="Organization">
            {visibleOrganization.map(item)}
          </ApplicationShell.NavigationSection>
        ) : null}
        {needle !== "" && visiblePersonal.length === 0 && visibleOrganization.length === 0 ? (
          <StateMessage state="no-results" placement="inline" title="No matching settings." />
        ) : null}
      </div>
    </div>
  )
}
