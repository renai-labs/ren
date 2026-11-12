import { Loading } from "@ren/ui/loading"
import { useState } from "react"
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  IconBook,
  IconCalendar,
  IconChecklist,
  IconCube,
  IconEdit,
  IconLayoutGrid,
  IconLock,
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
} from "@ren/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@ren/ui/dialog"
import { settingsSections } from "./settings-sidebar.js"
import { canAdministerOptions } from "../lib/auth.js"
import { pickerPageSize } from "../lib/pagination.js"
import { formatRelative } from "@ren/ui/time"
import { docsUrl, founderCallUrl } from "../lib/links.js"
import { Automations } from "../lib/automations.js"
import { ownChats, sessionTitle, sidebarSessionsOptions } from "../lib/sessions.js"
import { useDebouncedValue } from "../lib/use-debounced-value.js"
import { useMe } from "../lib/use-me.js"
import { RouterContext } from "../lib/router-context.js"
import { Platform } from "../platform/platform.js"

function ChatResults(props: {
  query: string
  limit: number
  spaceName: (spaceId: string) => string
  onOpen: (sessionId: string) => void
}) {
  const { api, client } = RouterContext.useRouterContext()
  const me = useMe()
  const needle = useDebouncedValue(props.query.trim(), 250)
  const recent = useInfiniteQuery(sidebarSessionsOptions(client, ownChats(me.user.id)))
  const found = useQuery({
    ...api.session.list.queryOptions({ search: needle, origin: [...Automations.chatOrigins], page: 1, pageSize: 20 }),
    enabled: needle !== "",
    placeholderData: keepPreviousData,
  })
  const listed = needle
    ? (found.data?.items ?? [])
    : (recent.data?.pages.flatMap((page) => page.items) ?? []).slice(0, props.limit)
  if ((needle ? found.isPending : recent.isPending) && listed.length === 0)
    return (
      <Loading label="Loading chats">
        <div className="flex items-center gap-2 px-2 py-1.5 text-sm">
          <IconMessage className="size-4" />
          <span>Recent conversation</span>
        </div>
      </Loading>
    )
  if (listed.length === 0) return null
  return (
    <CommandGroup heading={needle ? "Chats" : "Recent"}>
      {listed.map((chat) => (
        <CommandItem
          key={chat.id}
          value={`chat ${chat.id} ${sessionTitle(chat.title)}`}
          {...(needle && { keywords: [props.query] })}
          onSelect={() => props.onOpen(chat.id)}
        >
          <IconMessage />
          <span className="truncate">{sessionTitle(chat.title)}</span>
          <CommandShortcut className="flex shrink-0 gap-2 tracking-normal">
            <span className="max-w-40 truncate">{props.spaceName(chat.spaceId)}</span>
            <span className="tabular-nums">{formatRelative(chat.updatedAt)}</span>
          </CommandShortcut>
        </CommandItem>
      ))}
    </CommandGroup>
  )
}

export function SearchDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { api, auth } = RouterContext.useRouterContext()
  const platform = Platform.usePlatform()
  const open = props.open
  const admin = useQuery({ ...canAdministerOptions(auth), enabled: open }).data === true
  const navigate = useNavigate()
  const [query, setQuery] = useState("")
  const typed = query.trim() !== ""
  const spaces = useQuery({ ...api.space.list.queryOptions({ page: 1, pageSize: pickerPageSize }), enabled: open })
  const spaceName = (spaceId: string) => spaces.data?.items.find((space) => space.id === spaceId)?.name ?? "Space"
  const go = (run: () => unknown) => {
    void run()
    props.onOpenChange(false)
    setQuery("")
  }
  const external = (url: string) => () => platform.openExternal(url)
  const actions = [
    { label: "New chat", icon: IconEdit, run: () => navigate({ to: "/" }) },
    { label: "Open tasks", icon: IconChecklist, run: () => navigate({ to: "/tasks" }) },
    { label: "Open spaces", icon: IconCube, run: () => navigate({ to: "/spaces" }) },
    { label: "Open marketplace", icon: IconLayoutGrid, run: () => navigate({ to: "/marketplace" }) },
    { label: "Open settings", icon: IconSettings, run: () => navigate({ to: "/settings/preferences" }) },
    { label: "Documentation", icon: IconBook, run: external(docsUrl) },
    { label: "Talk to founder", icon: IconCalendar, run: external(founderCallUrl) },
  ]
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        props.onOpenChange(next)
        if (!next) setQuery("")
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="top-[18%] translate-y-0 gap-0 overflow-hidden rounded-xl p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">Search chats, spaces, actions and settings.</DialogDescription>
        <Command className="rounded-none bg-transparent **:data-[slot=command-input]:ml-0.5 **:data-[slot=command-input-wrapper]:pl-2.5 **:data-[slot=input-group]:h-12 **:[[cmdk-group-heading]]:text-xs">
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search chats, spaces and settings…" />
          <CommandList className="max-h-96 scroll-py-2 p-1.5">
            <CommandEmpty>Nothing matches “{query.trim()}”.</CommandEmpty>
            {typed ? null : (
              <CommandGroup heading="Actions">
                {actions.slice(0, 2).map((action) => (
                  <CommandItem key={action.label} value={`action ${action.label}`} onSelect={() => go(action.run)}>
                    <action.icon />
                    {action.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <ChatResults
              query={query}
              limit={8}
              spaceName={spaceName}
              onOpen={(sessionId) => go(() => navigate({ to: "/sessions/$sessionId", params: { sessionId } }))}
            />
            {typed && spaces.data ? (
              <CommandGroup heading="Spaces">
                {spaces.data.items.map((space) => (
                  <CommandItem
                    key={space.id}
                    value={`space ${space.id} ${space.name}`}
                    onSelect={() => go(() => navigate({ to: "/spaces/$spaceId", params: { spaceId: space.id } }))}
                  >
                    {space.kind === "private" ? <IconLock /> : <IconCube />}
                    {space.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {typed ? (
              <CommandGroup heading="Actions">
                {actions.map((action) => (
                  <CommandItem key={action.label} value={`action ${action.label}`} onSelect={() => go(action.run)}>
                    <action.icon />
                    {action.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {typed ? (
              <CommandGroup heading="Settings">
                {settingsSections.flatMap((section) =>
                  section.items
                    .filter((item) => admin || !("admin" in item))
                    .map((item) => (
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
        </Command>
      </DialogContent>
    </Dialog>
  )
}
