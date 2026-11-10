import { useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { Composer, type ChatSession } from "@ren/chat"
import { SessionMessage } from "@ren/schema/session/message"
import { cn } from "cn"
import type { Suggest } from "./use-composer-suggestions.js"
import { toast } from "@ren/ui/sonner"
import { useQuery } from "@tanstack/react-query"
import {
  IconApps,
  IconArrowUp,
  IconChevronRight,
  IconClipboardText,
  IconLoader2,
  IconPaperclip,
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
import { Command, CommandGroup, CommandItem, CommandList } from "@ren/ui/command"
import { Spinner } from "@ren/ui/spinner"
import { useUploads, type Target } from "../../lib/use-uploads.js"
import { DropOverlay, UploadChips } from "./attachments.js"
import { MentionOverlay } from "@ren/ui/mention-overlay"
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
import { ProfileDialog, type ProfileTarget } from "../../components/profile-dialog.js"
import { AddAppDialog } from "../../components/add-app-dialog.js"
import { RepositoriesDialog } from "./repositories-picker.js"
import { useApps } from "../../lib/use-app.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { gaps, isSpaceApp } from "../../lib/apps.js"
import { useStep } from "../../lib/use-step.js"
import { RouterContext } from "../../lib/router-context.js"

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
      <DropdownMenuContent side="top" align="start" className="w-52">
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

function AppsStrip(props: { spaceId: string }) {
  const { api } = RouterContext.useRouterContext()
  const spaces = useSpaces()
  const spaceName = spaces.spaceName
  const space = spaces.spaces.find((each) => each.id === props.spaceId)
  const from = {
    spaceId: props.spaceId,
    name: spaceName(props.spaceId),
    members: space?.memberCount ?? 1,
    private: space?.kind === "private",
  }
  const [connecting, setConnecting] = useState<ProfileTarget & { fromAdding?: boolean }>()
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const reach = useQuery({
    ...api["app-profile-reach"].space.profiles.queryOptions({ id: props.spaceId }),
    retry: false,
  })
  const reached = reach.data?.profiles ?? []
  const catalog = useApps(reached.map((profile) => profile.appId))
  const profiles = reached
    .filter((profile) => !isSpaceApp(catalog.of(profile.appId), spaces.spaces))
    .map((profile) => ({
      id: profile.id,
      appId: profile.appId,
      name: profile.name,
      app: catalog.of(profile.appId)?.name ?? profile.appSlug,
      icon: catalog.of(profile.appId)?.icon ?? undefined,
      gaps: gaps(profile),
    }))
  if (reach.isPending || catalog.pending) return null
  const apps = [...new Map(profiles.map((profile) => [profile.app, profile.icon] as const))]
  const shown = apps.slice(0, 3)
  const missing = profiles.filter((profile) => profile.gaps.length > 0).length
  const dialogs = (
    <>
      <AddAppDialog
        space={{ id: props.spaceId, name: spaceName(props.spaceId) }}
        added={new Set(profiles.map((profile) => profile.appId))}
        onAdded={(added) => setConnecting({ appId: added.app.id, profileId: added.profileId, from, fromAdding: true })}
        open={adding}
        onOpenChange={setAdding}
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
  if (profiles.length === 0)
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
              aria-label={`Apps: ${apps.map(([app]) => app).join(", ")}${missing ? `, ${missing} not connected` : ""}`}
            />
          }
        >
          <AvatarGroup className="-space-x-1.5 *:data-[slot=avatar]:ring-card *:data-[slot=avatar-group-count]:ring-card">
            {shown.map(([app, icon]) => (
              // ast-grep-ignore: require-avatar-fallback -- AppAvatarFallback renders the AvatarFallback
              <Avatar key={app} size="sm" className="data-[size=sm]:size-5">
                <AppAvatarImage src={icon} />
                <AppAvatarFallback name={app} />
              </Avatar>
            ))}
            {apps.length > shown.length ? (
              <AvatarGroupCount className="size-5 text-2xs group-has-data-[size=sm]/avatar-group:size-5">
                +{apps.length - shown.length}
              </AvatarGroupCount>
            ) : null}
          </AvatarGroup>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-80 gap-0 p-1">
          <PopoverTitle className="sr-only">Apps this chat can use</PopoverTitle>
          {profiles.map((profile) => (
            <div key={profile.id} className="group/row relative flex items-center gap-3 rounded-md p-2 hover:bg-accent">
              <Avatar // ast-grep-ignore: require-avatar-fallback -- AppAvatarFallback renders the AvatarFallback
                size="sm"
                className="data-[size=sm]:size-5"
              >
                <AppAvatarImage src={profile.icon} />
                <AppAvatarFallback name={profile.app} />
              </Avatar>
              <Button
                variant="ghost"
                className="h-auto min-w-0 flex-1 flex-col items-stretch gap-0 rounded-none border-0 p-0 text-left font-normal after:absolute after:inset-0 after:rounded-md hover:bg-transparent focus-visible:ring-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50 active:not-aria-[haspopup]:scale-none"
                onClick={() => {
                  setOpen(false)
                  setConnecting({ appId: profile.appId, profileId: profile.id, from, edit: true })
                }}
              >
                <span className="truncate text-sm">{profile.app}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {profile.gaps.length ? "Not connected" : "Connected"}
                </span>
              </Button>
              {profile.gaps.length ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="relative shrink-0"
                  onClick={() => {
                    setOpen(false)
                    setConnecting({ appId: profile.appId, profileId: profile.id, from })
                  }}
                >
                  Connect
                </Button>
              ) : (
                <IconChevronRight className="size-4 shrink-0 text-muted-foreground" />
              )}
            </div>
          ))}
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

export type PromptInputBoot = Exclude<ChatSession.Boot, { readonly _tag: "Ready" }> | { readonly _tag: "Reconnecting" }

function PromptInputStatus(props: { boot: PromptInputBoot; onRetry?: (() => void) | undefined }) {
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
  return (
    <Command
      value={suggest.active ?? ""}
      shouldFilter={false}
      className={cn(
        "absolute inset-x-0 z-20 h-auto w-full rounded-xl bg-popover shadow-overlay",
        props.below ? "top-full mt-2" : "bottom-full mb-2",
      )}
    >
      <CommandList className="max-h-72">
        <CommandGroup
          heading={
            <span className="flex items-center justify-between gap-2">
              {suggest.label}
              {suggest.searching ? (
                <span className="flex items-center gap-1">
                  <Spinner aria-hidden className="size-3" />
                  Searching all apps
                </span>
              ) : null}
            </span>
          }
        >
          {suggest.items.map((item) => (
            <CommandItem
              key={item.value}
              value={item.value}
              onMouseDown={(event) => event.preventDefault()}
              onSelect={() => choose(item.value)}
            >
              {item.kind === "command" ? <IconTerminal2 /> : null}
              {item.kind === "repository" ? <GitHubMark /> : null}
              {item.kind === "command" || item.kind === "repository" ? null : (
                <AppIcon name={item.label} icon={item.icon} size="sm" className="size-4 rounded-sm" />
              )}
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium text-foreground">{item.label}</span>
                {item.description ? <span className="text-muted-foreground"> {item.description}</span> : null}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

function SendIcon(props: { sending: boolean; stop: boolean }) {
  if (props.sending) return <IconLoader2 className="animate-spin" />
  if (props.stop) return <IconPlayerStopFilled />
  return <IconArrowUp />
}

function SendButton(props: { blank: boolean; stop: boolean; sending: boolean; booting: boolean; onClick: () => void }) {
  return (
    <InputGroupButton
      variant={!props.blank || props.stop ? "default" : "secondary"}
      size="icon-sm"
      className={cn("rounded-full", props.booting && "pointer-events-none opacity-50")}
      aria-disabled={props.booting || undefined}
      aria-label={props.stop ? "Stop" : "Send"}
      onClick={props.onClick}
    >
      <SendIcon sending={props.sending} stop={props.stop} />
    </InputGroupButton>
  )
}

const textareaClass = (layout: { home: boolean; marked: boolean }) =>
  cn(
    "px-4 pt-4 leading-relaxed",
    layout.home ? "min-h-24" : "max-h-60 min-h-16",
    layout.marked && "text-transparent caret-foreground",
  )

function composerState(
  props: {
    readonly boot?: PromptInputBoot | undefined
    readonly running?: boolean | undefined
    readonly sending?: boolean | undefined
    readonly onStop?: (() => void) | undefined
  },
  draft: { readonly blank: boolean },
) {
  const booting = props.boot?._tag === "Starting"
  return {
    booting,
    sending: props.sending === true,
    status: props.boot && (draft.blank || booting) ? props.boot : undefined,
    stop: Boolean(props.running && draft.blank && props.onStop),
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
  children: ReactNode
}) {
  return (
    <InputGroupAddon align="block-end" className="px-3 pt-0 pb-3">
      <AddMenu
        onInsert={props.onInsert}
        onAttach={props.onAttach}
        onRepositories={props.spaceId ? props.onRepositories : undefined}
      />
      {props.spaceId ? <AppsStrip spaceId={props.spaceId} /> : null}
      {props.children}
    </InputGroupAddon>
  )
}

export function PromptInput(props: {
  value: Composer.Draft
  onChange: (draft: Composer.Draft) => void
  onSubmit: () => void
  placement: "home" | "chat"
  spaceId: string | undefined
  model: ReactNode
  boot?: PromptInputBoot | undefined
  onRetry?: (() => void) | undefined
  running?: boolean | undefined
  onStop?: (() => void) | undefined
  sending?: boolean | undefined
  suggest?: Suggest | undefined
  files: Target
}) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const [repositories, setRepositories] = useState(false)
  const draft = props.value
  const uploads = useUploads(props.files, draft)
  const picker = useRef<HTMLInputElement>(null)
  const text = draft.text
  const blank = Composer.isBlank(draft)
  const state = composerState(props, { blank })
  const booting = state.booting
  const uploading = uploads.uploads.length > 0
  const change = (next: Composer.Draft) => props.onChange(next)
  const attach = (files: ReadonlyArray<File>) => {
    if (!props.sending) uploads.add(files)
  }
  const submit = () => {
    if (props.sending || booting) return
    if (uploading) {
      toast("Wait for the files to upload", {
        description: "Send the message once every file is uploaded, or remove the ones that failed.",
      })
      return
    }
    if (blank) {
      if (props.running) props.onStop?.()
      return
    }
    props.onSubmit()
  }
  const home = props.placement === "home"
  const status = state.status
  const send = (
    <SendButton
      blank={blank}
      stop={state.stop}
      sending={state.sending}
      booting={booting || uploading}
      onClick={submit}
    />
  )
  const place = (next: string, cursor: number) =>
    requestAnimationFrame(() => {
      const node = textarea.current
      if (!node || node.value !== next) return
      node.focus()
      node.setSelectionRange(cursor, cursor)
    })
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
    place(result.text, result.cursor)
  }
  const suggest = props.suggest
  const marks = suggest?.marks(text) ?? []
  return (
    <div className="relative flex flex-col gap-2">
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
      <InputGroup className="rounded-xl bg-card shadow-soft dark:bg-card">
        {status ? <PromptInputStatus boot={status} onRetry={props.onRetry} /> : null}
        <MentionOverlay textarea={textarea} text={text} marks={marks} />
        <InputGroupTextarea
          value={text}
          onChange={(event) => {
            const next = event.target.value
            change(Composer.withText(draft, next))
            props.suggest?.onCursor(next, event.target.selectionStart)
          }}
          onBlur={() => props.suggest?.onClose()}
          onPaste={(event) => {
            const data = event.clipboardData
            const pasted = data.getData("text/plain")
            const kind = Composer.paste(
              { types: [...data.types], kinds: [...data.items].map((item) => item.kind), text: pasted },
              { readClipboardImage: false },
            )
            if (kind === "text") return
            event.preventDefault()
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
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
            event.preventDefault()
            submit()
          }}
          placeholder={status ? "" : "Ask anything, @ to add an app"}
          aria-label="Message"
          readOnly={state.sending || booting}
          aria-busy={booting || undefined}
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the composer is the page’s one input, as in Ren
          autoFocus
          rows={1}
          className={textareaClass({ home, marked: marks.length > 0 })}
        />
        <ComposerToolbar
          spaceId={props.spaceId}
          onInsert={insert}
          onAttach={() => picker.current?.click()}
          onRepositories={() => setRepositories(true)}
        >
          {props.model}
          {send}
        </ComposerToolbar>
      </InputGroup>
    </div>
  )
}
