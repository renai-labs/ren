import {
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react"
import { Composer, ComposerHistory, Mentions, type ChatSession } from "@ren/chat"
import { Drive } from "@ren/schema/drive"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import { cn } from "cn"
import type { Suggest } from "./use-composer-suggestions.js"
import { toast } from "@ren/ui/sonner"
import {
  IconApps,
  IconLayoutGridAdd,
  IconArrowUp,
  IconChevronDown,
  IconChevronRight,
  IconFolder,
  IconGitBranch,
  IconQuote,
  IconLoader2,
  IconPaperclip,
  IconPlayerPlay,
  IconPlayerStopFilled,
  IconPlus,
  IconTerminal2,
  IconX,
} from "@tabler/icons-react"
import { AttachmentGroup } from "@ren/ui/attachment"
import { Avatar } from "@ren/ui/avatar"
import { FileIcon } from "@ren/ui/file-icon"
import { Separator } from "@ren/ui/separator"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@ren/ui/command"
import { Spinner } from "@ren/ui/spinner"
import { useUploads, type Target } from "../../lib/use-uploads.js"
import { formatBytes, plural } from "../../lib/format.js"
import { UploadChips } from "./attachments.js"
import { DropOverlay } from "../../components/drop-overlay.js"
import { PastedChip } from "./pasted-chip.js"
import { ImageSet } from "../../components/image-set.js"
import { MentionOverlay } from "@ren/ui/mention-overlay"
import { Artifacts } from "../../lib/artifacts.js"
import { AppAvatarFallback, AppAvatarImage, AppIcon } from "../../components/app-icon.js"
import { Button } from "@ren/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Input } from "@ren/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@ren/ui/input-group"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@ren/ui/popover"
import { ProfileDialog, useAddManaged, type ProfileTarget } from "../../components/profile-dialog.js"
import { AddAppDialog } from "../../components/add-app-dialog.js"
import { RepositoriesDialog } from "./repositories-picker.js"
import { StatusDot } from "../../components/status-dot.js"
import { isBundle, statusAction, statusLabel, waitsForUser, type CatalogApp, type Status } from "../../lib/apps.js"
import { useApps } from "../../lib/use-app.js"
import { errorMessage } from "../../lib/errors.js"
import { connectTarget, useSpaceApps } from "./use-space-apps.js"
import { ComposerMotion } from "../../lib/composer-motion.js"
import { useCountdown } from "../../lib/use-countdown.js"
import { useHeld } from "../../lib/use-held.js"
import { AgentIcon, ChatIcon, mentionIcons, RepositoryIcon, TaskIcon } from "../../components/mention-icon.js"
import { useRoom } from "../../lib/use-room.js"
import { Drafts } from "../../lib/drafts.js"
import type { ShellHistory } from "../../lib/use-shell-history.js"
import { Keyboard } from "../../platform/keyboard.js"
import { ChatKeys } from "./chat-keys.js"

function AddMenu(props: {
  onAttach: () => void
  onApps?: (() => void) | undefined
  onRepositories?: (() => void) | undefined
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <InputGroupButton
            variant="secondary"
            size="icon-sm"
            className="rounded-full [&_svg]:transition-transform data-popup-open:[&_svg]:rotate-45"
            aria-label="Add to this chat"
          />
        }
      >
        <IconPlus />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={props.onAttach}>
            <IconPaperclip />
            Upload attachment
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {props.onApps ? (
            <DropdownMenuItem onClick={props.onApps}>
              <IconApps />
              Apps
            </DropdownMenuItem>
          ) : null}
          {props.onRepositories ? (
            <DropdownMenuItem onClick={props.onRepositories}>
              <IconGitBranch />
              Repositories
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function useControlled(control: { value?: boolean | undefined; onChange?: ((value: boolean) => void) | undefined }) {
  const [local, setLocal] = useState(false)
  return [
    control.value ?? local,
    (next: boolean) => {
      setLocal(next)
      control.onChange?.(next)
    },
  ] as const
}

const addingApps = (state: { adding: boolean; empty: boolean; requested: boolean }) =>
  state.adding || (state.empty && state.requested)

function AppsStrip(props: {
  spaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  adding: boolean
  onAddingChange: (adding: boolean) => void
}) {
  const space = useSpaceApps(props.spaceId)
  const [connecting, setConnecting] = useState<ProfileTarget & { fromAdding?: boolean }>()
  const open = props.open
  const setOpen = props.onOpenChange
  const adding = props.adding
  const setAdding = props.onAddingChange
  const from = space.from
  if (space.pending || !from) return null
  const apps = [...new Set(space.profiles.map((profile) => profile.appId))].flatMap((appId) => {
    const app = space.app(appId)
    return app ? [{ app, status: space.status(appId), here: space.here(appId) }] : []
  })
  const only = apps.length === 1 ? apps[0] : undefined
  const expired = apps.filter((each) => each.status === "expired").length
  const dialogs = (
    <>
      <AddAppDialog
        space={{ id: props.spaceId, name: from.name }}
        added={new Set(apps.map((each) => each.app.id))}
        onPick={(app) => setConnecting({ appId: app.id, from, fromAdding: true })}
        open={addingApps({ adding, empty: apps.length === 0, requested: open })}
        onOpenChange={(next) => {
          setAdding(next)
          if (!next) setOpen(false)
        }}
      />
      {connecting ? (
        <ProfileDialog
          {...connecting}
          onClose={() => {
            if (connecting.fromAdding) setAdding(true)
            setConnecting(undefined)
          }}
        />
      ) : null}
    </>
  )
  if (apps.length === 0)
    return (
      <>
        <InputGroupButton size="sm" className="-ml-1 font-normal text-muted-foreground" onClick={() => setAdding(true)}>
          <IconLayoutGridAdd />
          Add Apps
        </InputGroupButton>
        {dialogs}
      </>
    )
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <InputGroupButton
              size="sm"
              className="-ml-1 font-normal text-muted-foreground data-popup-open:text-foreground"
              aria-label={`Apps: ${apps.map((each) => each.app.name).join(", ")}${expired ? `, ${expired} ${statusLabel.expired.toLowerCase()}` : ""}`}
            />
          }
        >
          <span className="relative">
            {only ? (
              <AppIcon name={only.app.name} icon={only.app.icon} size="sm" className="size-4 rounded-sm" />
            ) : (
              <IconApps />
            )}
            {expired ? (
              <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-chart-3 ring-2 ring-card" />
            ) : null}
          </span>
          {only ? only.app.name : plural(apps.length, "app")}
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-80 gap-0 p-1">
          <PopoverTitle className="sr-only">Apps this chat can use</PopoverTitle>
          <Command filter={matchesAppName} className="h-auto rounded-none p-0">
            <CommandInput placeholder="Search apps" aria-label="Search apps" />
            <CommandList className="pt-1">
              <CommandEmpty>No apps found</CommandEmpty>
              <CommandGroup className="p-0">
                {apps.map((each) => (
                  <AppStatusItem
                    key={each.app.id}
                    app={each.app}
                    status={each.status}
                    onOpen={() => {
                      setOpen(false)
                      setConnecting({ appId: each.app.id, from })
                    }}
                    onAction={() => {
                      setOpen(false)
                      setConnecting(connectTarget({ appId: each.app.id, status: each.status, here: each.here }, from))
                    }}
                  />
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
          <Separator className="my-1" />
          <Button
            variant="ghost"
            className="justify-start gap-3 px-2 font-normal text-muted-foreground"
            onClick={() => {
              setOpen(false)
              setAdding(true)
            }}
          >
            <IconPlus />
            Add more apps
          </Button>
        </PopoverContent>
      </Popover>
      {dialogs}
    </>
  )
}

const matchesAppName = (_appId: string, search: string, names?: ReadonlyArray<string>) =>
  names?.some((name) => name.toLowerCase().includes(search.trim().toLowerCase())) ? 1 : 0

function AppStatusItem(props: {
  app: Pick<CatalogApp, "id" | "name" | "icon">
  status: Status
  onOpen: () => void
  onAction: () => void
}) {
  const action = statusAction[props.status]
  return (
    // ast-grep-ignore: require-item-group -- rows render inside the apps popover's CommandGroup
    <CommandItem
      value={props.app.id}
      keywords={[props.app.name]}
      className="gap-3 rounded-md p-2 [&>svg:last-child]:hidden"
      onSelect={props.onOpen}
    >
      <Avatar // ast-grep-ignore: require-avatar-fallback -- AppAvatarFallback renders the AvatarFallback
        size="sm"
        className="data-[size=sm]:size-5"
      >
        <AppAvatarImage src={props.app.icon ?? undefined} />
        <AppAvatarFallback name={props.app.name} />
      </Avatar>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">{props.app.name}</span>
        <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          <StatusDot status={props.status} />
          {statusLabel[props.status]}
        </span>
      </span>
      {action ? (
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            props.onAction()
          }}
        >
          {action}
        </Button>
      ) : (
        <IconChevronRight className="text-muted-foreground" />
      )}
    </CommandItem>
  )
}

type MentionStatus = {
  readonly app: Composer.MentionedApp
  readonly status: Status
}

const bundleStatus = (
  mention: MentionStatus,
  app: CatalogApp | undefined,
  partOf: (slug: string) => { readonly app: CatalogApp; readonly status: Status | "absent" } | undefined,
  options: { readonly added: boolean },
): MentionStatus => {
  if (!app || !isBundle(app)) return mention
  const ready = app.dependsOn.every((slug) => {
    const part = partOf(slug)
    return !part || (part.status !== "absent" && !waitsForUser(part.status))
  })
  return { ...mention, status: options.added && ready ? "connected" : "missing" }
}

function useMentions(spaceId: string | undefined, suggest: Suggest | undefined, text: string) {
  const mentioned = suggest?.mentioned(text) ?? []
  const [adding, setAdding] = useState(false)
  const full = useApps(mentioned.map((app) => app.id))
  const partSlugs = mentioned.flatMap((app) => full.of(app.id)?.dependsOn ?? [])
  const parts = useApps(partSlugs)
  const space = useSpaceApps(spaceId, [
    ...mentioned.map((app) => app.id),
    ...partSlugs.flatMap((slug) => parts.of(slug)?.id ?? []),
  ])
  const addManaged = useAddManaged()
  const statuses = space.pending
    ? []
    : mentioned.map((app) =>
        bundleStatus(
          { app, status: space.status(app.id) },
          full.of(app.id),
          (slug) => {
            const part = parts.of(slug)
            if (!part) return
            return { app: part, status: space.here(part.id).length === 0 ? "absent" : space.status(part.id) }
          },
          { added: space.here(app.id).length > 0 },
        ),
      )
  return {
    space,
    statuses,
    adding,
    send: (onSubmit: () => void) => {
      const from = space.from
      const missing = statuses.flatMap((each) => {
        const app = space.app(each.app.id)
        return app && each.status === "credits" && space.here(app.id).length === 0 ? [app] : []
      })
      if (missing.length === 0 || !from) return onSubmit()
      setAdding(true)
      void Promise.all(
        missing.map((app) =>
          addManaged(app, from).catch((error: unknown) =>
            toast.error(`Couldn’t add ${app.name} to ${from.name}`, { description: errorMessage(error) }),
          ),
        ),
      )
        .then(onSubmit)
        .finally(() => setAdding(false))
    },
  }
}

export type PromptInputBoot =
  | Exclude<ChatSession.Boot, { readonly _tag: "Ready" }>
  | { readonly _tag: "Reconnecting" }
  | { readonly _tag: "Waiting"; readonly retryAt: number }

function RetryCountdown(props: { retryAt: number }) {
  return <span className="mr-auto">Reconnecting in {useCountdown(props.retryAt)}s…</span>
}

function PromptInputStatus(props: {
  boot: Exclude<PromptInputBoot, { readonly _tag: "Checking" | "Starting" }>
  onRetry?: (() => void) | undefined
  onRetryNow?: (() => void) | undefined
}) {
  if (props.boot._tag === "Waiting")
    return (
      <div className="absolute inset-x-4 top-3 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <IconLoader2 className="size-3.5 animate-spin" />
        <RetryCountdown retryAt={props.boot.retryAt} />
        <Button variant="outline" size="sm" onClick={props.onRetryNow}>
          Try now
        </Button>
      </div>
    )
  if (props.boot._tag === "Failed")
    return (
      <div className="absolute inset-x-4 top-3 flex min-w-0 items-center gap-2">
        <span className="mr-auto min-w-0 text-sm text-muted-foreground">Couldn’t start this chat</span>
        <Popover>
          <PopoverTrigger render={<Button variant="ghost" size="sm" />}>Details</PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-80">
            <PopoverTitle>Startup error</PopoverTitle>
            <p className="max-h-40 overflow-y-auto overscroll-contain font-mono text-xs/5 break-all whitespace-pre-wrap text-muted-foreground">
              {props.boot.reason}
            </p>
          </PopoverContent>
        </Popover>
        <Button variant="outline" size="sm" onClick={props.onRetry}>
          Retry
        </Button>
      </div>
    )
  if (props.boot._tag === "Stopped")
    return (
      <div className="pointer-events-none absolute inset-x-4 top-3 flex min-w-0 items-center gap-2">
        <span className="mr-auto min-w-0 text-sm text-muted-foreground">
          This space was shut down. Send a message or retry to start it again.
        </span>
        <Button variant="outline" size="sm" className="pointer-events-auto" onClick={props.onRetry}>
          Retry
        </Button>
      </div>
    )
  return (
    <span className="pointer-events-none absolute inset-x-4 top-4 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <IconLoader2 className="size-3.5 animate-spin" />
      Reconnecting…
    </span>
  )
}

function ShellPrefix(props: { active: boolean }) {
  if (!props.active) return null
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-4 left-4 font-mono leading-relaxed text-muted-foreground"
    >
      $
    </span>
  )
}

const linksOf = (text: string) =>
  [...text.matchAll(/https?:\/\/[^\s<>"'`]+/gu)].map((match) => {
    const url = (match.at(0) ?? "").replace(/[.,;:!?)\]}'"]+$/u, "")
    return {
      start: match.index,
      end: match.index + url.length,
      label: url,
      icon: null,
      color: "var(--link)",
      file: false,
      link: true,
    }
  })

const placeholder = (input: { readonly status: unknown; readonly shell: boolean }) => {
  if (input.status) return ""
  return input.shell ? "e.g. git status" : "Ask anything, @ to mention"
}

function QuoteChips(props: {
  quotes: ReadonlyArray<Composer.Quote>
  disabled: boolean | undefined
  onRemove: (id: string) => void
}) {
  return (
    <>
      {props.quotes.map((quote) => (
        <div
          key={quote.id}
          title={quote.text}
          className="flex max-w-72 min-w-0 animate-in items-start gap-2 rounded-lg bg-muted/50 py-1.5 pr-1 pl-2.5 text-sm text-muted-foreground duration-150 ease-out fade-in-0 zoom-in-95 motion-reduce:animate-none"
        >
          <IconQuote aria-hidden className="mt-0.75 size-3.5 shrink-0" />
          <span className="line-clamp-2 min-w-0 flex-1 leading-5 whitespace-pre-wrap">{quote.text}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Remove quote"
            disabled={props.disabled}
            className="-my-0.75 shrink-0 text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5"
            onClick={() => props.onRemove(quote.id)}
          >
            <IconX />
          </Button>
        </div>
      ))}
    </>
  )
}

const categoryIcons = {
  tasks: <TaskIcon />,
  chats: <ChatIcon />,
  apps: <IconApps />,
  agents: <AgentIcon />,
  files: <IconFolder />,
  repos: <RepositoryIcon />,
}

function SuggestionIcon(props: { item: Suggest["items"][number] }) {
  const item = props.item
  if (item.kind === "app") return <AppIcon name={item.label} icon={item.icon} size="sm" className="size-4 rounded-sm" />
  if (item.kind === "category") return item.category ? categoryIcons[item.category] : null
  if (item.kind === "command") return <IconTerminal2 />
  if (item.kind === "repository") return <RepositoryIcon />
  if (item.kind === "folder") return <IconFolder />
  if (item.kind === "file") return <FileIcon name={item.label} />
  return mentionIcons[item.kind] ?? <AgentIcon />
}

function SuggestionMenu(props: {
  suggest: Suggest
  anchor: RefObject<HTMLElement | null>
  below: boolean
  onChoose: (value: string) => void
}) {
  const suggest = props.suggest
  const choose = props.onChoose
  const room = useRoom(props.anchor, { open: suggest.open, prefer: props.below ? "below" : "above", want: 304 })
  // oxlint-disable-next-line ren/no-comments -- While a search runs, the menu keeps the last results it showed, hidden under Searching…, so it holds its height instead of following each half-finished query.
  const items = useHeld(suggest.items, {
    holding: suggest.searching,
    key: (list) => list.map((item) => item.value).join("\n"),
  })
  if (!suggest.open) return null
  const listed = [...new Set(items.map((item) => item.group))].map((heading) => ({
    heading,
    items: items.filter((item) => item.group === heading),
  }))
  return (
    <Command
      value={suggest.active ?? ""}
      shouldFilter={false}
      className={cn(
        "absolute inset-x-0 z-20 flex h-auto w-full flex-col rounded-xl bg-popover shadow-overlay",
        (room?.below ?? props.below) ? "top-full mt-2" : "bottom-full mb-2",
        suggest.searching && "min-h-11",
      )}
      // oxlint-disable-next-line react/forbid-component-props -- the menu is only as tall as the room its pane leaves it
      style={room ? { maxHeight: room.height } : undefined}
    >
      {suggest.searching ? (
        <output className="absolute inset-x-0 top-0 z-10 flex animate-in items-center gap-2 px-3.5 py-3 text-sm text-muted-foreground delay-100 duration-150 fade-in-0 fill-mode-backwards motion-reduce:animate-none">
          <Spinner aria-hidden className="size-3.5" />
          Searching…
        </output>
      ) : null}
      <CommandList
        className={cn(
          "max-h-72 min-h-0 flex-1 transition-opacity duration-150 ease-out motion-reduce:transition-none",
          suggest.searching && "opacity-0",
        )}
        label={suggest.label}
        inert={suggest.searching}
      >
        {listed.map((group) => (
          <CommandGroup key={group.heading ?? ""} heading={group.heading}>
            {group.items.map((item) => (
              <CommandItem
                key={item.value}
                value={item.value}
                onMouseDown={(event) => event.preventDefault()}
                onSelect={() => choose(item.value)}
              >
                <SuggestionIcon item={item} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium text-foreground">{item.label}</span>
                  {item.description ? <span className="text-muted-foreground"> {item.description}</span> : null}
                </span>
                {item.status ? (
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <StatusDot status={item.status} />
                    {statusLabel[item.status]}
                  </span>
                ) : null}
                {item.kind === "category" || item.kind === "folder" ? (
                  <CommandShortcut className="-mr-1 flex">
                    <IconChevronRight stroke={2.75} />
                  </CommandShortcut>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  )
}

function SendIcon(props: { sending: boolean; stop: boolean; shell: boolean }) {
  if (props.sending) return <IconLoader2 className="animate-spin" />
  if (props.stop) return <IconPlayerStopFilled />
  if (props.shell) return <IconPlayerPlay />
  return <IconArrowUp />
}

const sendLabel = (props: { stop: boolean; shell: boolean }) => {
  if (props.stop) return "Stop"
  return props.shell ? "Run command" : "Send"
}

const half =
  "text-inherit hover:bg-current/10 hover:text-inherit aria-expanded:bg-current/10 aria-expanded:text-inherit active:not-aria-[haspopup]:scale-100"

interface Send {
  readonly blank: boolean
  readonly stop: boolean
  readonly shell: boolean
  readonly sending: boolean
  readonly booting: boolean
  readonly uploading: boolean
  readonly onClick: () => void
}

const sendState = (props: Send) => ({
  filled: !props.booting && (!props.blank || props.stop),
  idle: props.blank && !props.stop && !props.booting && !props.sending,
})

function SendButton(props: Send & { split?: boolean }) {
  const state = sendState(props)
  const variant = state.filled ? "default" : "secondary"
  return (
    <InputGroupButton
      variant={props.split ? "ghost" : variant}
      size="icon-sm"
      className={cn(
        props.split ? ["w-8.5 rounded-none pl-0.5", half] : "rounded-full",
        props.booting && "pointer-events-none",
        props.uploading && "pointer-events-none opacity-50",
      )}
      disabled={state.idle}
      aria-disabled={props.booting || props.uploading || undefined}
      aria-label={sendLabel(props)}
      onClick={props.onClick}
    >
      <SendIcon sending={props.sending || props.booting} stop={props.stop} shell={props.shell} />
    </InputGroupButton>
  )
}

function SendPill(props: Send & { other: { readonly label: string; readonly onSelect: () => void } }) {
  return (
    <span
      className={cn(
        "flex h-8 items-center overflow-hidden rounded-full transition-colors duration-150 ease-out",
        sendState(props).filled ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground",
      )}
    >
      <SendButton {...props} split />
      <span aria-hidden className="h-4 w-px shrink-0 bg-current opacity-20" />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <InputGroupButton
              variant="ghost"
              size="icon-sm"
              className={cn("w-7 rounded-none pr-0.5 [&_svg:not([class*='size-'])]:size-3.5", half)}
              aria-label="Send options"
              disabled={props.blank || props.booting || props.uploading || props.sending}
            />
          }
        >
          <IconChevronDown />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={props.other.onSelect}>
              {props.other.label}
              <DropdownMenuShortcut>{ChatKeys.apple ? "⌘↵" : "Ctrl ↵"}</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )
}

const textareaClass = (layout: { home: boolean; marked: boolean; shell: boolean }) =>
  cn(
    "px-4 pt-4 leading-relaxed",
    layout.home ? "max-h-80 min-h-24" : "max-h-60 min-h-16",
    layout.marked && "text-transparent caret-foreground selection:text-transparent",
    layout.shell && "pl-9 font-mono",
  )

function composerState(
  props: {
    readonly boot?: PromptInputBoot | undefined
    readonly preparing?: boolean | undefined
    readonly running?: boolean | undefined
    readonly sending?: boolean | undefined
    readonly onStop?: (() => void) | undefined
  },
  draft: { readonly blank: boolean; readonly adding: boolean; readonly shell: boolean },
) {
  const boot = props.boot
  return {
    booting: props.preparing === true,
    sending: props.sending === true || draft.adding,
    status: boot && boot._tag !== "Checking" && boot._tag !== "Starting" && draft.blank ? boot : undefined,
    stop: Boolean(props.running && draft.blank && props.onStop && !draft.shell),
  }
}

function suggestionKey(suggest: Suggest, event: KeyboardEvent<HTMLTextAreaElement>, choose: (value: string) => void) {
  if (!suggest.open || event.nativeEvent.isComposing) return false
  const opens =
    event.key === "ArrowRight" &&
    suggest.items.some((item) => item.value === suggest.active && (item.kind === "category" || item.kind === "folder"))
  if ((event.key === "Enter" || event.key === "Tab" || opens) && suggest.active && !event.shiftKey) {
    event.preventDefault()
    choose(suggest.active)
    return true
  }
  if (!suggest.onKey({ key: event.key, ctrlKey: event.ctrlKey, isComposing: false })) return false
  event.preventDefault()
  return true
}

function ComposerToolbar(props: {
  spaceId: string | undefined
  onAttach: () => void
  onRepositories: () => void
  shell: boolean
  model: ReactNode
  apps: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void } | undefined
  children: ReactNode
}) {
  const shell = props.shell
  const [appsOpen, setAppsOpen] = useControlled({ value: props.apps?.open, onChange: props.apps?.onOpenChange })
  const [adding, setAdding] = useState(false)
  return (
    <InputGroupAddon align="block-end" className="px-3 pt-0 pb-3">
      {shell ? null : (
        <AddMenu
          onAttach={props.onAttach}
          onApps={props.spaceId ? () => setAdding(true) : undefined}
          onRepositories={props.spaceId ? props.onRepositories : undefined}
        />
      )}
      {props.spaceId && !shell ? (
        <AppsStrip
          spaceId={props.spaceId}
          open={appsOpen}
          onOpenChange={setAppsOpen}
          adding={adding}
          onAddingChange={setAdding}
        />
      ) : null}
      {shell ? (
        <span className="mr-auto pl-1 text-sm text-muted-foreground">Shell</span>
      ) : (
        <span aria-hidden className="ml-auto" />
      )}
      {shell ? null : props.model}
      {props.children}
    </InputGroupAddon>
  )
}

function startsShell(
  draft: Composer.Draft,
  next: string,
  input: { readonly history: ShellHistory | undefined; readonly suggestOpen: boolean },
) {
  return (
    next === "!" &&
    input.history !== undefined &&
    !input.suggestOpen &&
    Composer.isBlank(draft) &&
    draft.pasted.length === 0 &&
    Composer.files(draft).length === 0 &&
    Composer.quotes(draft).length === 0 &&
    Composer.mentions(draft).length === 0
  )
}

function shellKey(
  event: KeyboardEvent<HTMLTextAreaElement>,
  input: { readonly running: boolean; readonly text: string; readonly leave: () => void },
) {
  if (event.nativeEvent.isComposing) return false
  const leaves =
    (event.key === "Escape" && !input.running) ||
    (event.key === "Backspace" && input.text === "" && event.currentTarget.selectionStart === 0)
  if (leaves) event.preventDefault()
  if (leaves) input.leave()
  return leaves
}

function useShellMode(input: {
  history: ShellHistory | undefined
  draft: Composer.Draft
  locked: boolean
  uploading: boolean
  onChange: (draft: Composer.Draft) => void
  textarea: RefObject<HTMLTextAreaElement | null>
  suggest: Suggest | undefined
}) {
  const history = input.history
  const active = history !== undefined && Composer.isShell(input.draft)
  const toggle = () => {
    if (!history || input.locked) return
    if (
      !active &&
      (input.uploading || Composer.files(input.draft).length > 0 || Composer.quotes(input.draft).length > 0)
    )
      return
    input.onChange(Composer.withMode(input.draft, active ? "prompt" : "shell"))
    history.reset()
    input.suggest?.onClose()
    input.textarea.current?.focus()
  }
  Keyboard.useKeyDown((event) => {
    if (!ChatKeys.toggleShell(event)) return
    event.preventDefault()
    toggle()
  })
  return {
    active,
    toggle,
    suggest: active ? undefined : input.suggest,
  }
}

function pasteKind(event: ClipboardEvent<HTMLTextAreaElement>) {
  const data = event.clipboardData
  return Composer.paste(
    { types: [...data.types], kinds: [...data.items].map((item) => item.kind), text: data.getData("text/plain") },
    { readClipboardImage: false },
  )
}

export function PromptInput(props: {
  textareaRef?: Ref<HTMLTextAreaElement | null> | undefined
  value: Composer.Draft
  onChange: (draft: Composer.Draft) => void
  onSubmit: (options: { readonly alternative: boolean }) => void
  onChooseModel?: (() => void) | undefined
  placement: "home" | "chat"
  spaceId: string | undefined
  model: ReactNode
  boot?: PromptInputBoot | undefined
  preparing?: boolean | undefined
  onRetry?: (() => void) | undefined
  onRetryNow?: (() => void) | undefined
  running?: boolean | undefined
  onStop?: (() => void) | undefined
  sending?: boolean | undefined
  suggest?: Suggest | undefined
  artifact?: Artifacts.Mention | undefined
  history?: ShellHistory | undefined
  files: Target
  header?: ReactNode
  queue?: ReactNode
  apps?: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void } | undefined
  alternative?: string | undefined
}) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle<HTMLTextAreaElement | null, HTMLTextAreaElement | null>(props.textareaRef, () => textarea.current)
  const [repositories, setRepositories] = useState(false)
  const draft = props.value
  const uploads = useUploads(props.files, draft)
  const picker = useRef<HTMLInputElement>(null)
  const text = draft.text
  const blank = Composer.isBlank(draft)
  const mentions = useMentions(props.spaceId, props.suggest, text)
  const uploading = uploads.uploads.length > 0
  const shellMode = useShellMode({
    history: props.history,
    draft,
    locked: props.sending === true,
    uploading,
    onChange: props.onChange,
    textarea,
    suggest: props.suggest,
  })
  const shell = shellMode.active
  const toggleShell = shellMode.toggle
  const state = composerState(props, { blank, adding: mentions.adding, shell })
  const booting = state.booting
  const change = (next: Composer.Draft) => props.onChange(next)
  const attach = (files: ReadonlyArray<File>) => {
    if (!props.sending && !shell) uploads.add(files)
  }
  const history = Drafts.useHistory()
  const [browsing, setBrowsing] = useState(ComposerHistory.idle)
  const submit = (options: { readonly alternative: boolean }) => {
    if (state.sending || booting) return
    if (uploading) {
      toast("Wait for the files to upload", {
        description: "Send the message once every file is uploaded, or remove the ones that failed.",
      })
      return
    }
    if (blank) {
      if (state.stop) props.onStop?.()
      return
    }
    setBrowsing(ComposerHistory.idle)
    mentions.send(() => props.onSubmit(options))
  }
  const home = props.placement === "home"
  const status = state.status
  const sendProps = {
    blank,
    stop: state.stop,
    shell,
    sending: state.sending,
    booting,
    uploading,
    onClick: () => submit({ alternative: false }),
  }
  const send =
    props.alternative && !shell ? (
      <SendPill {...sendProps} other={{ label: props.alternative, onSelect: () => submit({ alternative: true }) }} />
    ) : (
      <SendButton {...sendProps} />
    )
  const place = (next: string, cursor: number) =>
    requestAnimationFrame(() => {
      const node = textarea.current
      if (!node || node.value !== next) return
      node.focus()
      node.setSelectionRange(cursor, cursor)
    })
  const browse = (node: HTMLTextAreaElement, direction: "up" | "down") => {
    if (node.selectionStart !== node.selectionEnd) return false
    const moved = ComposerHistory.navigate(browsing, direction, history.read(), draft, node.selectionStart)
    if (!moved) return false
    setBrowsing(moved.browsing)
    change(Composer.fromHistory(draft, moved.entry))
    place(moved.entry.text, moved.cursor === "start" ? 0 : moved.entry.text.length)
    return true
  }
  const act = (action: ChatKeys.Action | "swallow", node: HTMLTextAreaElement) => {
    if (action === "historyUp" || action === "historyDown") return browse(node, action === "historyUp" ? "up" : "down")
    if (action === "send" || action === "sendOther") {
      if (!blank) submit({ alternative: action === "sendOther" })
      return true
    }
    if (action === "stop") props.onStop?.()
    if (action === "chooseModel") props.onChooseModel?.()
    return action !== "editQueued"
  }
  const recall = (direction: "up" | "down", event: KeyboardEvent<HTMLTextAreaElement>) => {
    const entry = props.history?.step(direction, text, event.currentTarget.selectionStart)
    if (!entry) return
    event.preventDefault()
    change(Composer.withText(draft, entry.text))
    place(entry.text, entry.cursor === "start" ? 0 : entry.text.length)
  }
  const choose = (value: string) => {
    const result = props.suggest?.onChoose(value, text, textarea.current?.selectionStart ?? text.length)
    if (!result) return
    const next = Composer.withText(draft, result.text)
    const picked = result.picked ? Composer.withPicked(next, result.picked) : next
    const mentioned = result.mention ? Composer.withMention(picked, result.mention) : picked
    change(result.file ? Composer.withFile(mentioned, result.file) : mentioned)
    if (result.focus !== false) place(result.text, result.cursor)
  }
  const suggest = shellMode.suggest
  const root = useRef<HTMLDivElement | null>(null)
  ComposerMotion.useComposer(root, { placement: props.placement })
  const artifact = props.artifact
  const ranges = Artifacts.mentionRanges(text, artifact)
  const mentioned = [
    ...(suggest?.marks(text) ?? [])
      .filter((mark) => !ranges.some((range) => mark.start < range.end && mark.end > range.start))
      // oxlint-disable-next-line oxc/no-map-spread -- a draft has a few marks, and each one gets its kind's icon
      .map((mark) => ({ ...mark, glyph: mentionIcons[mark.kind] })),
    ...ranges.map((range) => ({
      start: range.start,
      end: range.end,
      label: artifact?.title ?? "",
      icon: null,
      color: "var(--primary)",
      file: false,
    })),
  ]
  const marks = [
    ...mentioned,
    ...linksOf(text).filter((link) => !mentioned.some((mark) => link.start < mark.end && link.end > mark.start)),
  ].toSorted((a, b) => a.start - b.start)
  const attachments =
    Composer.files(draft).length + uploads.uploads.length + Composer.quotes(draft).length + draft.pasted.length > 0
  return (
    <div ref={root} className="relative flex flex-col gap-2">
      {suggest ? <SuggestionMenu suggest={suggest} anchor={root} below={home} onChoose={choose} /> : null}
      <DropOverlay
        title="Drop files to attach"
        detail={`Up to ${Session.maxDriveFiles} files, ${formatBytes(Drive.maxUploadBytes)} each`}
        onFiles={attach}
      />
      <Input
        ref={picker}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          attach([...(event.target.files ?? [])])
          event.target.value = ""
        }}
      />
      <div className="flex flex-wrap items-center gap-1 empty:hidden">{props.header}</div>
      {repositories && props.spaceId ? (
        <RepositoriesDialog spaceId={props.spaceId} onClose={() => setRepositories(false)} />
      ) : null}
      {props.queue}
      <InputGroup
        data-shell={shell}
        className="rounded-xl bg-card shadow-soft data-[shell=true]:border-primary data-[shell=true]:ring-3 data-[shell=true]:ring-primary/15 dark:bg-card"
        onDragOver={(event) => {
          if (suggest && event.dataTransfer.types.includes(Mentions.fileDragType)) event.preventDefault()
        }}
        onDrop={(event) => {
          const path = event.dataTransfer.getData(Mentions.fileDragType)
          if (!suggest || !path) return
          event.preventDefault()
          const result = Mentions.insertFile(text, path, textarea.current?.selectionStart ?? text.length)
          change(Composer.withText(draft, result.text))
          place(result.text, result.cursor)
        }}
      >
        {attachments ? (
          <InputGroupAddon align="block-start" className="px-3 pt-3">
            <ImageSet>
              <AttachmentGroup className="w-full py-0">
                <UploadChips
                  spaceId={props.files.spaceId}
                  files={Composer.files(draft)}
                  uploads={uploads.uploads}
                  disabled={props.sending}
                  onRetry={uploads.retry}
                  onCancel={uploads.cancel}
                  onRemove={uploads.remove}
                />
                <QuoteChips
                  quotes={Composer.quotes(draft)}
                  disabled={props.sending}
                  onRemove={(id) => change(Composer.withoutQuote(draft, id))}
                />
                {draft.pasted.map((block) => (
                  <PastedChip
                    key={block.id}
                    text={block.text}
                    disabled={props.sending}
                    onEdit={() => change(Composer.showPasted(draft, block.id, text.length).draft)}
                    onRemove={() => change(Composer.removePasted(draft, block.id))}
                  />
                ))}
              </AttachmentGroup>
            </ImageSet>
          </InputGroupAddon>
        ) : null}
        {status ? <PromptInputStatus boot={status} onRetry={props.onRetry} onRetryNow={props.onRetryNow} /> : null}
        <MentionOverlay textarea={textarea} text={text} marks={marks} labelClassName="bg-card" />
        <InputGroupTextarea
          dir="auto"
          value={text}
          onChange={(event) => {
            const next = event.target.value
            setBrowsing(ComposerHistory.idle)
            if (shell) {
              props.history?.reset()
              change(Composer.withText(draft, next))
              return
            }
            if (startsShell(draft, next, { history: props.history, suggestOpen: props.suggest?.open === true })) {
              change(Composer.withMode(draft, "shell"))
              return
            }
            change(Composer.withText(draft, next))
            props.suggest?.onCursor(next, event.target.selectionStart)
          }}
          onBlur={() => props.suggest?.onClose()}
          onPaste={(event) => {
            const data = event.clipboardData
            const pasted = data.getData("text/plain")
            const kind = pasteKind(event)
            if (kind === "text" || (shell && kind === "block")) return
            event.preventDefault()
            if (shell) return
            if (kind === "attachment")
              attach(
                data.files.length > 0
                  ? [...data.files]
                  : [...data.items].flatMap((item) => (item.kind === "file" ? (item.getAsFile() ?? []) : [])),
              )
            else change(Composer.addPasted(draft, { id: SessionMessage.ID.create(), text: pasted }))
          }}
          ref={textarea}
          onKeyDown={(event) => {
            if (shell) {
              if (shellKey(event, { running: props.running === true, text, leave: toggleShell })) return
              if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                recall(event.key === "ArrowUp" ? "up" : "down", event)
                return
              }
            }
            if (suggest && suggestionKey(suggest, event, choose)) return
            const removed = suggest?.unmention(text, {
              key: event.key,
              selectionStart: event.currentTarget.selectionStart,
              selectionEnd: event.currentTarget.selectionEnd,
            })
            if (removed) {
              event.preventDefault()
              change(Composer.withText(draft, removed.text))
              place(removed.text, removed.cursor)
              return
            }
            const action = ChatKeys.intent(
              {
                key: event.key,
                metaKey: event.metaKey,
                ctrlKey: event.ctrlKey,
                shiftKey: event.shiftKey,
                altKey: event.altKey,
                repeat: event.repeat,
                isComposing: event.nativeEvent.isComposing,
              },
              { apple: ChatKeys.apple, running: Boolean(props.running) },
            )
            if (action && act(action, event.currentTarget)) event.preventDefault()
          }}
          placeholder={placeholder({ status, shell })}
          aria-label={shell ? "Command" : "Message"}
          readOnly={state.sending}
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the composer is the page’s one input, as in Ren
          autoFocus
          rows={1}
          className={textareaClass({ home, marked: marks.length > 0, shell })}
        />
        <ShellPrefix active={shell} />
        <ComposerToolbar
          spaceId={props.spaceId}
          onAttach={() => picker.current?.click()}
          onRepositories={() => setRepositories(true)}
          shell={shell}
          model={props.model}
          apps={props.apps}
        >
          {send}
        </ComposerToolbar>
      </InputGroup>
    </div>
  )
}
