import { Combobox } from "@ren/ui/combobox"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@ren/ui/dialog"
import { Icon } from "@ren/ui/icon"
import type { Glyph } from "@ren/ui/icon"
import { Kbd } from "@ren/ui/kbd"
import { Tabs, TabsList, TabsTrigger } from "@ren/ui/tabs"
import { Text } from "@ren/ui/text"
import { Theme } from "@ren/ui/theme"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { Links } from "../lib/links.js"
import { Search } from "@ren/util/search"
import { Platform } from "../platform/platform.js"
import { SettingsPages } from "./settings-pages.js"

const filters = ["all", "actions", "settings"] as const
type Filter = (typeof filters)[number]

const filterLabels: Record<Filter, string> = { all: "All", actions: "Actions", settings: "Settings" }
const placeholders: Record<Filter, string> = {
  all: "Search actions and settings…",
  actions: "Search actions…",
  settings: "Search settings…",
}

type Entry = { value: string; label: string; glyph: Glyph; hint?: string; keywords?: ReadonlyArray<string> }

const actions: ReadonlyArray<Entry> = [
  { value: "new-chat", label: "New Chat", glyph: "Compose", keywords: ["create", "start"] },
  { value: "spaces", label: "Open Spaces", glyph: "Cube", keywords: ["groups", "people"] },
  { value: "marketplace", label: "Open Marketplace", glyph: "LayoutGrid", keywords: ["apps", "integrations", "mcp"] },
  { value: "settings", label: "Open Settings", glyph: "Settings" },
  { value: "light", label: "Use Light Theme", glyph: "Sun", hint: "Appearance", keywords: ["appearance", "mode"] },
  { value: "dark", label: "Use Dark Theme", glyph: "Moon", hint: "Appearance", keywords: ["appearance", "mode"] },
  {
    value: "system",
    label: "Use System Theme",
    glyph: "Monitor",
    hint: "Appearance",
    keywords: ["appearance", "mode", "auto"],
  },
  { value: "docs", label: "Documentation", glyph: "BookOpen", keywords: ["help", "docs"] },
  { value: "founder", label: "Talk to Founder", glyph: "Calendar", keywords: ["help", "call", "support"] },
]

const settings: ReadonlyArray<Entry> = [
  ...SettingsPages.personal.map((page) => ({ value: page.to, label: page.label, glyph: page.glyph, hint: "Personal" })),
  ...SettingsPages.organization.map((page) => ({
    value: page.to,
    label: page.label,
    glyph: page.glyph,
    hint: "Organization",
    keywords: ["organization"],
  })),
]

const externalLinks: Partial<Record<string, string>> = {
  docs: Links.docs,
  founder: Links.founderCall,
}

export function WorkspaceSearch(props: { onClose: () => void }) {
  const navigate = useNavigate()
  const platform = Platform.usePlatform()
  const theme = Theme.useTheme()
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const needle = query.trim().toLowerCase()
  const matching = (entries: ReadonlyArray<Entry>) =>
    entries
      .filter((entry) => Search.matches([entry.label, entry.hint ?? "", ...(entry.keywords ?? [])], needle))
      .map((entry) => ({
        value: entry.value,
        label: entry.label,
        icon: <Icon glyph={entry.glyph} />,
        detail: entry.hint,
      }))
  const groups = [
    { value: "actions", label: "Actions", items: filter === "settings" ? [] : matching(actions) },
    { value: "settings", label: "Settings", items: filter === "actions" ? [] : matching(settings) },
  ].filter((group) => group.items.length > 0)
  const run = (value: string) => {
    props.onClose()
    const link = externalLinks[value]
    if (link !== undefined) return platform.openExternal(link)
    if (value === "light" || value === "dark" || value === "system") return theme.setPreference(value)
    if (value === "new-chat") return void navigate({ to: "/" })
    if (value === "spaces") return void navigate({ to: "/spaces" })
    if (value === "marketplace") return void navigate({ to: "/marketplace" })
    const page = [...SettingsPages.personal, ...SettingsPages.organization].find((entry) => entry.to === value)
    void navigate({ to: page?.to ?? "/settings" })
  }
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent showCloseButton={false} className="flex h-120 flex-col gap-0 overflow-hidden p-0 sm:max-w-168">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">Search actions and settings.</DialogDescription>
        <Combobox.Panel
          purpose="command"
          filtering="external"
          searchSize="large"
          label="Search"
          searchPlaceholder={placeholders[filter]}
          query={query}
          onQueryChange={setQuery}
          onSearchKeyDown={(event) => {
            if (event.key !== "Tab") return
            event.preventDefault()
            const step = event.shiftKey ? -1 : 1
            setFilter(filters[(filters.indexOf(filter) + step + filters.length) % filters.length] ?? "all")
          }}
          value={null}
          onValueChange={(value) => (value === null ? undefined : run(value))}
          emptyMessage="No results."
          groups={groups}
          header={
            <Tabs value={filter} onValueChange={(value: Filter) => setFilter(value)} className="shrink-0 border-b p-2">
              <TabsList variant="page" aria-label="Filter results" className="h-7">
                {filters.map((value) => (
                  <TabsTrigger key={value} value={value} className="h-7 text-xs">
                    {filterLabels[value]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          }
          footer={<Hints />}
        />
      </DialogContent>
    </Dialog>
  )
}

function Hints() {
  return (
    <div className="flex items-center justify-end gap-4 px-2 py-1">
      <Text
        purpose="caption"
        element="span"
        leadingIcon={
          <>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
          </>
        }
      >
        Select
      </Text>
      <Text purpose="caption" element="span" leadingIcon={<Kbd>↵</Kbd>}>
        Open
      </Text>
      <Text purpose="caption" element="span" leadingIcon={<Kbd>Tab</Kbd>}>
        Change filter
      </Text>
    </div>
  )
}
