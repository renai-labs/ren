import { useState } from "react"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  IconArrowDown,
  IconArrowUp,
  IconBook,
  IconCalendar,
  IconChecklist,
  IconCornerDownLeft,
  IconCube,
  IconEdit,
  IconLayoutGrid,
  IconMessage,
  IconSettings,
} from "@tabler/icons-react"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { settingsSections } from "@/components/ren/settings-sidebar"
import { api, pickerPageSize } from "@/lib/api"
import { formatRelative } from "@/lib/format"
import { docsUrl, founderCallUrl } from "@/lib/links"
import { sessionTitle, sidebarSessionsOptions } from "@/lib/sessions"
import { closeSearch, useSearchOpen } from "@/stores/ui"

const filters = [
  { value: "all", label: "All", placeholder: "Search chats, spaces, actions…" },
  { value: "chats", label: "Chats", placeholder: "Search chats…" },
  { value: "spaces", label: "Spaces", placeholder: "Search spaces…" },
  { value: "actions", label: "Actions", placeholder: "Search actions…" },
  { value: "settings", label: "Settings", placeholder: "Search settings…" },
] as const

type Filter = (typeof filters)[number]["value"]

export function SearchDialog() {
  const open = useSearchOpen()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>("all")
  const chats = useInfiniteQuery({ ...sidebarSessionsOptions(), enabled: open })
  const spaces = useQuery({ ...api.space.list.queryOptions({ page: 1, pageSize: pickerPageSize }), enabled: open })
  const spaceName = (spaceId: string) => spaces.data?.items.find((space) => space.id === spaceId)?.name ?? "Space"
  const show = (group: Filter) => filter === "all" || filter === group
  const go = (run: () => unknown) => {
    void run()
    closeSearch()
  }
  const external = (url: string) => () => window.open(url, "_blank", "noopener,noreferrer")
  const actions = [
    { label: "New chat", icon: IconEdit, run: () => navigate({ to: "/" }) },
    { label: "Open spaces", icon: IconCube, run: () => navigate({ to: "/spaces" }) },
    { label: "Open tasks", icon: IconChecklist, run: () => navigate({ to: "/tasks" }) },
    { label: "Open marketplace", icon: IconLayoutGrid, run: () => navigate({ to: "/marketplace" }) },
    { label: "Open settings", icon: IconSettings, run: () => navigate({ to: "/settings/preferences" }) },
    { label: "Documentation", icon: IconBook, run: external(docsUrl) },
    { label: "Talk to founder", icon: IconCalendar, run: external(founderCallUrl) },
  ]
  const recent = (chats.data?.pages.flatMap((page) => page.items) ?? []).slice(0, filter === "chats" ? 30 : 6)
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : closeSearch())}>
      <DialogContent showCloseButton={false} className="top-[24%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">Search chats, spaces, actions and settings.</DialogDescription>
        <Command
          className="rounded-none!"
          onKeyDown={(event) => {
            if (event.key !== "Tab") return
            event.preventDefault()
            const index = filters.findIndex((each) => each.value === filter)
            const next = filters.at((index + (event.shiftKey ? -1 : 1)) % filters.length)
            if (next) setFilter(next.value)
          }}
        >
          <CommandInput
            placeholder={filters.find((each) => each.value === filter)?.placeholder}
            className="text-base"
          />
          <Tabs value={filter} onValueChange={(value: Filter) => setFilter(value)} className="-mx-1 border-b p-2">
            <TabsList className="h-7 gap-1 bg-transparent p-0">
              {filters.map((each) => (
                <TabsTrigger
                  key={each.value}
                  value={each.value}
                  className="h-7 flex-none px-3 text-xs font-normal data-active:font-medium group-data-[variant=default]/tabs-list:data-active:shadow-none dark:data-active:border-transparent dark:data-active:bg-secondary"
                >
                  {each.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <CommandList className="max-h-88 p-1">
            <CommandEmpty>Nothing matches.</CommandEmpty>
            {show("chats") && recent.length > 0 ? (
              <CommandGroup heading="Recent chats">
                {recent.map((chat) => (
                  <CommandItem
                    key={chat.id}
                    value={`chat ${chat.id} ${sessionTitle(chat.title)}`}
                    onSelect={() => go(() => navigate({ to: "/sessions/$sessionId", params: { sessionId: chat.id } }))}
                  >
                    <IconMessage />
                    <span className="truncate">{sessionTitle(chat.title)}</span>
                    <CommandShortcut className="tracking-normal">
                      {spaceName(chat.spaceId)} · {formatRelative(chat.updatedAt)}
                    </CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {show("spaces") && spaces.data ? (
              <CommandGroup heading="Spaces">
                {spaces.data.items.map((space) => (
                  <CommandItem
                    key={space.id}
                    value={`space ${space.id} ${space.name}`}
                    onSelect={() => go(() => navigate({ to: "/spaces/$spaceId", params: { spaceId: space.id } }))}
                  >
                    <IconCube />
                    {space.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {show("actions") ? (
              <CommandGroup heading="Actions">
                {actions.map((action) => (
                  <CommandItem key={action.label} value={`action ${action.label}`} onSelect={() => go(action.run)}>
                    <action.icon />
                    {action.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {show("settings") ? (
              <CommandGroup heading="Settings">
                {settingsSections.flatMap((section) =>
                  section.items.map((item) => (
                    <CommandItem
                      key={item.to}
                      value={`setting ${item.label}`}
                      onSelect={() => go(() => navigate({ to: item.to }))}
                    >
                      <item.icon />
                      {item.label}
                      <CommandShortcut className="tracking-normal">{section.label}</CommandShortcut>
                    </CommandItem>
                  )),
                )}
              </CommandGroup>
            ) : null}
          </CommandList>
          <div className="-mx-1 -mb-1 flex items-center justify-end gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
            <Kbd>
              <IconArrowUp />
            </Kbd>
            <Kbd>
              <IconArrowDown />
            </Kbd>
            <span className="mr-2">Select</span>
            <Kbd>
              <IconCornerDownLeft />
            </Kbd>
            <span className="mr-2">Open</span>
            <Kbd>Tab</Kbd>
            <span>Change filter</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
