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
import { Composer, ComposerHistory, type ChatSession } from "@ren/chat"
import { SessionMessage } from "@ren/schema/session/message"
import { cn } from "cn"
import type { Suggest } from "./use-composer-suggestions.js"
import { toast } from "@ren/ui/sonner"
import {
  IconApps,
  IconArrowUp,
  IconChevronRight,
  IconClipboardText,
  IconFile,
  IconLoader2,
  IconPaperclip,
  IconPlayerPlay,
  IconPlayerStopFilled,
  IconPlus,
  IconTerminal2,
  IconX,
} from "@tabler/icons-react"
import { GitHubMark } from "../../icons/brands.js"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@ren/ui/attachment"
import { Avatar, AvatarGroup, AvatarGroupCount } from "@ren/ui/avatar"
import { Kbd } from "@ren/ui/kbd"
import { Separator } from "@ren/ui/separator"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@ren/ui/command"
import { Spinner } from "@ren/ui/spinner"
import { useUploads, type Target } from "../../lib/use-uploads.js"
import { DropOverlay, UploadChips } from "./attachments.js"
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
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Input } from "@ren/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@ren/ui/input-group"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@ren/ui/popover"
import { ProfileDialog, useAddManaged, type ProfileTarget } from "../../components/profile-dialog.js"
import { AddAppDialog } from "../../components/add-app-dialog.js"
import { RepositoriesDialog } from "./repositories-picker.js"
import { StatusDot } from "../../components/app-list.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { isSpaceApp, statusAction, statusLabel, type CatalogApp, type Status } from "../../lib/apps.js"
import { errorMessage } from "../../lib/errors.js"
import { connectTarget, isReady, useSpaceApps } from "./use-space-apps.js"
import { useStep } from "../../lib/use-step.js"
import { ComposerMotion } from "../../lib/composer-motion.js"
import { useCountdown } from "../../lib/use-countdown.js"
import { Drafts } from "../../lib/drafts.js"
import type { ShellHistory } from "../../lib/use-shell-history.js"
import { Keyboard } from "../../platform/keyboard.js"
import { ChatKeys } from "./chat-keys.js"

function AddMenu(props: {
  onInsert: (text: string) => void
  onAttach: () => void
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
          <DropdownMenuItem onClick={() => props.onInsert("@")}>
            <IconApps />
            Apps
            <Kbd className="ml-auto">@</Kbd>
          </DropdownMenuItem>
          {props.onRepositories ? (
            <DropdownMenuItem onClick={props.onRepositories}>
              <GitHubMark />
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

function AppsStrip(props: { spaceId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const spaces = useSpaces()
  const space = useSpaceApps(props.spaceId)
  const [connecting, setConnecting] = useState<ProfileTarget & { fromAdding?: boolean }>()
  const open = props.open
  const setOpen = props.onOpenChange
  const [adding, setAdding] = useState(false)
  const from = space.from
  if (space.pending || !from) return null
  const apps = [...new Set(space.profiles.map((profile) => profile.appId))].flatMap((appId) => {
    const app = space.app(appId)
    return app && !isSpaceApp(app, spaces.spaces) ? [{ app, status: space.status(appId), here: space.here(appId) }] : []
  })
  const shown = apps.slice(0, 3)
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
          <IconApps />
          Add apps
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
              className="-ml-1 font-normal"
              aria-label={`Apps: ${apps.map((each) => each.app.name).join(", ")}${expired ? `, ${expired} ${statusLabel.expired.toLowerCase()}` : ""}`}
            />
          }
        >
          <AvatarGroup className="-space-x-1.5 *:data-[slot=avatar]:ring-card *:data-[slot=avatar-group-count]:ring-card">
            {shown.map((each) => (
              // ast-grep-ignore: require-avatar-fallback -- AppAvatarFallback renders the AvatarFallback
              <Avatar key={each.app.id} size="sm" className="data-[size=sm]:size-5">
                <AppAvatarImage src={each.app.icon ?? undefined} />
                <AppAvatarFallback name={each.app.name} />
              </Avatar>
            ))}
            {apps.length > shown.length ? (
              <AvatarGroupCount className="size-5 text-2xs group-has-data-[size=sm]/avatar-group:size-5">
                +{apps.length - shown.length}
              </AvatarGroupCount>
            ) : null}
          </AvatarGroup>
          {expired ? <StatusDot status="expired" /> : null}
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

function MentionChips(props: {
  space: ReturnType<typeof useSpaceApps>
  statuses: ReadonlyArray<{ app: Composer.MentionedApp; status: Status }>
}) {
  const [connecting, setConnecting] = useState<ProfileTarget>()
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set())
  const space = props.space
  const from = space.from
  const shown = props.statuses.filter((each) => !isReady(each.status) || opened.has(each.app.id))
  if (shown.length === 0 || !from) return null
  return (
    <div className="ml-auto flex flex-wrap justify-end gap-1">
      {shown.map((each) => {
        const action = isReady(each.status) ? undefined : statusAction[each.status]
        return (
          <span
            key={each.app.id}
            className="flex h-8 items-center gap-2 rounded-full border bg-card pr-1 pl-1.5 text-sm"
          >
            <AppIcon name={each.app.name} icon={each.app.icon} size="sm" />
            <span className="font-medium">{each.app.name}</span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <StatusDot status={each.status} />
              {statusLabel[each.status]}
            </span>
            {action ? (
              <Button
                variant="secondary"
                size="sm"
                className="rounded-full"
                onClick={() => {
                  setOpened((previous) => new Set([...previous, each.app.id]))
                  setConnecting(
                    connectTarget({ appId: each.app.id, status: each.status, here: space.here(each.app.id) }, from),
                  )
                }}
              >
                {action}
              </Button>
            ) : null}
          </span>
        )
      })}
      {connecting ? <ProfileDialog {...connecting} onClose={() => setConnecting(undefined)} /> : null}
    </div>
  )
}

function useMentions(spaceId: string | undefined, suggest: Suggest | undefined, text: string) {
  const mentioned = suggest?.mentioned(text) ?? []
  const [adding, setAdding] = useState(false)
  const space = useSpaceApps(
    spaceId,
    mentioned.map((app) => app.id),
  )
  const addManaged = useAddManaged()
  const statuses = space.pending ? [] : mentioned.map((app) => ({ app, status: space.status(app.id) }))
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
  boot: PromptInputBoot
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
  if (props.boot._tag === "Checking")
    return (
      <span className="pointer-events-none absolute inset-x-4 top-4 flex min-w-0 animate-in items-center gap-2 text-xs text-muted-foreground delay-1000 duration-200 fade-in-0 fill-mode-backwards">
        <IconLoader2 className="size-3.5 animate-spin" />
        Connecting…
      </span>
    )
  if (props.boot._tag === "Reconnecting")
    return (
      <span className="pointer-events-none absolute inset-x-4 top-4 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <IconLoader2 className="size-3.5 animate-spin" />
        Reconnecting…
      </span>
    )
  return (
    <span className="pointer-events-none absolute inset-x-4 top-4 flex min-w-0">
      <BootLine />
    </span>
  )
}

const bootPhrases = [
  "Waking Ren up",
  "Pulling up a chair",
  "Laying out the tools",
  "Reading the room",
  "Sharpening pencils",
  "Almost there",
]

function BootLine() {
  const index = useStep({ last: bootPhrases.length - 1, everyMs: 2400 })
  return (
    <output className="flex items-center gap-2 text-sm text-muted-foreground">
      <span
        key={index}
        className="shimmer animate-in duration-200 ease-out fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none motion-reduce:shimmer-none"
      >
        {bootPhrases[index]}…
      </span>
    </output>
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

const placeholder = (input: { readonly status: PromptInputBoot | undefined; readonly shell: boolean }) => {
  if (input.status) return ""
  return input.shell ? "e.g. git status" : "Ask anything, @ to mention"
}

const lineCount = (text: string) => text.split("\n").length

function PastedBlocks(props: {
  pasted: ReadonlyArray<Composer.Pasted>
  disabled: boolean | undefined
  onShow: (id: string) => void
  onRemove: (id: string) => void
}) {
  return (
    <AttachmentGroup>
      {props.pasted.map((block) => (
        <Attachment key={block.id} size="sm">
          <AttachmentMedia>
            <IconClipboardText />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>Pasted text</AttachmentTitle>
            <AttachmentDescription className="tabular-nums">
              {lineCount(block.text)} {lineCount(block.text) === 1 ? "line" : "lines"}
            </AttachmentDescription>
          </AttachmentContent>
          <AttachmentTrigger
            aria-label="Show pasted text in the message"
            disabled={props.disabled}
            onClick={() => props.onShow(block.id)}
          />
          <AttachmentActions>
            <AttachmentAction
              aria-label="Remove pasted text"
              disabled={props.disabled}
              onClick={() => props.onRemove(block.id)}
            >
              <IconX />
            </AttachmentAction>
          </AttachmentActions>
        </Attachment>
      ))}
    </AttachmentGroup>
  )
}

function SuggestionMenu(props: { suggest: Suggest; below: boolean; onChoose: (value: string) => void }) {
  const suggest = props.suggest
  const choose = props.onChoose
  if (!suggest.open) return null
  const groups = (["Apps", "Repositories", "Files"] as const)
    .map((heading) => ({ heading, items: suggest.items.filter((item) => item.group === heading) }))
    .filter((group) => group.items.length > 0)
  const listed = groups.length > 0 ? groups : [{ heading: suggest.label, items: suggest.items }]
  return (
    <Command
      value={suggest.active ?? ""}
      shouldFilter={false}
      className={cn(
        "absolute inset-x-0 z-20 h-auto w-full rounded-xl bg-popover shadow-overlay",
        props.below ? "top-full mt-2" : "bottom-full mb-2",
      )}
    >
      <CommandList className="max-h-72" label={suggest.label}>
        {listed.map((group) => (
          <CommandGroup
            key={group.heading}
            heading={
              <span className="flex items-center justify-between gap-2">
                {group.heading}
                {suggest.searching && group.heading === listed.at(-1)?.heading ? (
                  <span className="flex items-center gap-1">
                    <Spinner aria-hidden className="size-3" />
                    Searching
                  </span>
                ) : null}
              </span>
            }
          >
            {group.items.map((item) => (
              <CommandItem
                key={item.value}
                value={item.value}
                onMouseDown={(event) => event.preventDefault()}
                onSelect={() => choose(item.value)}
              >
                {item.kind === "command" ? <IconTerminal2 /> : null}
                {item.kind === "repository" ? <GitHubMark /> : null}
                {item.kind === "file" ? <IconFile /> : null}
                {item.kind === "app" ? (
                  <AppIcon name={item.label} icon={item.icon} size="sm" className="size-4 rounded-sm" />
                ) : null}
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

function SendButton(props: {
  blank: boolean
  stop: boolean
  shell: boolean
  sending: boolean
  booting: boolean
  onClick: () => void
}) {
  return (
    <InputGroupButton
      variant={!props.blank || props.stop ? "default" : "secondary"}
      size="icon-sm"
      className={cn("rounded-full", props.booting && "pointer-events-none opacity-50")}
      aria-disabled={props.booting || undefined}
      aria-label={sendLabel(props)}
      onClick={props.onClick}
    >
      <SendIcon sending={props.sending} stop={props.stop} shell={props.shell} />
    </InputGroupButton>
  )
}

const textareaClass = (layout: { home: boolean; marked: boolean; shell: boolean }) =>
  cn(
    "px-4 pt-4 leading-relaxed",
    layout.home ? "min-h-24" : "max-h-60 min-h-16",
    layout.marked && "text-transparent caret-foreground",
    layout.shell && "pl-9 font-mono",
  )

function composerState(
  props: {
    readonly boot?: PromptInputBoot | undefined
    readonly running?: boolean | undefined
    readonly sending?: boolean | undefined
    readonly onStop?: (() => void) | undefined
  },
  draft: { readonly blank: boolean; readonly adding: boolean; readonly shell: boolean },
) {
  const booting = props.boot?._tag === "Starting"
  return {
    booting,
    sending: props.sending === true || draft.adding,
    status: props.boot && (draft.blank || booting) ? props.boot : undefined,
    stop: Boolean(props.running && draft.blank && props.onStop && !draft.shell),
  }
}

function suggestionKey(suggest: Suggest, event: KeyboardEvent<HTMLTextAreaElement>, choose: (value: string) => void) {
  if (!suggest.open || event.nativeEvent.isComposing) return false
  if ((event.key === "Enter" || event.key === "Tab") && suggest.active && !event.shiftKey) {
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
  onInsert: (character: string) => void
  onAttach: () => void
  onRepositories: () => void
  shell: boolean
  model: ReactNode
  apps: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void } | undefined
  children: ReactNode
}) {
  const shell = props.shell
  const [appsOpen, setAppsOpen] = useControlled({ value: props.apps?.open, onChange: props.apps?.onOpenChange })
  return (
    <InputGroupAddon align="block-end" className="px-3 pt-0 pb-3">
      {shell ? null : (
        <AddMenu
          onInsert={props.onInsert}
          onAttach={props.onAttach}
          onRepositories={props.spaceId ? props.onRepositories : undefined}
        />
      )}
      {props.spaceId && !shell ? (
        <AppsStrip spaceId={props.spaceId} open={appsOpen} onOpenChange={setAppsOpen} />
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
    if (!active && (input.uploading || Composer.files(input.draft).length > 0)) return
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
  const send = (
    <SendButton
      blank={blank}
      stop={state.stop}
      shell={shell}
      sending={state.sending}
      booting={booting || uploading}
      onClick={() => submit({ alternative: false })}
    />
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
  const insert = (character: string) => {
    const next = character === "/" && !text ? "/" : `${text}${text && !text.endsWith(" ") ? " " : ""}${character}`
    change(Composer.withText(draft, next))
    props.suggest?.onCursor(next, next.length)
    place(next, next.length)
  }
  const choose = (value: string) => {
    const result = props.suggest?.onChoose(value, text, textarea.current?.selectionStart ?? text.length)
    if (!result) return
    const next = Composer.withText(draft, result.text)
    change(result.mention ? Composer.withMention(next, result.mention) : next)
    if (result.focus !== false) place(result.text, result.cursor)
  }
  const suggest = shellMode.suggest
  const root = useRef<HTMLDivElement | null>(null)
  ComposerMotion.useComposer(root, { placement: props.placement })
  const artifact = props.artifact
  const ranges = Artifacts.mentionRanges(text, artifact)
  const marks = [
    ...(suggest?.marks(text) ?? []).filter(
      (mark) => !ranges.some((range) => mark.start < range.end && mark.end > range.start),
    ),
    ...ranges.map((range) => ({
      start: range.start,
      end: range.end,
      label: artifact?.title ?? "",
      icon: null,
      color: "var(--primary)",
    })),
  ].toSorted((a, b) => a.start - b.start)
  return (
    <div ref={root} className="relative flex flex-col gap-2">
      {suggest ? <SuggestionMenu suggest={suggest} below={home} onChoose={choose} /> : null}
      <DropOverlay onFiles={attach} />
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
      <div className="flex flex-wrap items-center gap-1 empty:hidden">
        {props.header}
        <MentionChips space={mentions.space} statuses={mentions.statuses} />
      </div>
      <UploadChips
        spaceId={props.files.spaceId}
        files={Composer.files(draft)}
        uploads={uploads.uploads}
        disabled={props.sending}
        onRetry={uploads.retry}
        onCancel={uploads.cancel}
        onRemove={uploads.remove}
      />
      {draft.pasted.length > 0 ? (
        <PastedBlocks
          pasted={draft.pasted}
          disabled={props.sending}
          onShow={(id) => change(Composer.showPasted(draft, id, text.length).draft)}
          onRemove={(id) => change(Composer.removePasted(draft, id))}
        />
      ) : null}
      {repositories && props.spaceId ? (
        <RepositoriesDialog spaceId={props.spaceId} onClose={() => setRepositories(false)} />
      ) : null}
      {props.queue}
      <InputGroup
        data-shell={shell}
        className="rounded-xl bg-card shadow-soft data-[shell=true]:border-primary data-[shell=true]:ring-3 data-[shell=true]:ring-primary/15 dark:bg-card"
      >
        {status ? <PromptInputStatus boot={status} onRetry={props.onRetry} onRetryNow={props.onRetryNow} /> : null}
        <MentionOverlay textarea={textarea} text={text} marks={marks} />
        <InputGroupTextarea
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
          readOnly={state.sending || booting}
          aria-busy={booting || undefined}
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the composer is the page’s one input, as in Ren
          autoFocus
          rows={1}
          className={textareaClass({ home, marked: marks.length > 0, shell })}
        />
        <ShellPrefix active={shell} />
        <ComposerToolbar
          spaceId={props.spaceId}
          onInsert={insert}
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
