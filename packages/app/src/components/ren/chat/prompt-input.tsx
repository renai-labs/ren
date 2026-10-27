import { useEffect, useRef, useState, type ReactNode } from "react"
import { Composer, type ChatSession } from "@ren/chat"
import { SessionMessage } from "@ren/schema/session/message"
import { cn } from "@/lib/utils"
import type { Suggest } from "@/routes/chat/use-composer-suggestions"
import { toast } from "sonner"
import { useQuery } from "@tanstack/react-query"
import {
  IconArrowUp,
  IconAt,
  IconClipboardText,
  IconPaperclip,
  IconLoader2,
  IconPlayerStopFilled,
  IconPlus,
  IconTerminal2,
  IconX,
} from "@tabler/icons-react"
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
} from "@/components/ui/attachment"
import { Avatar, AvatarFallback, AvatarGroup, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Kbd } from "@/components/ui/kbd"
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command"
import { AttachmentChips, DropOverlay, useAttachments } from "@/components/ren/chat/attachments"
import { MentionOverlay } from "@/components/ren/chat/mention-overlay"
import { AppIcon } from "@/components/ren/app-icon"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { ProfileDialog, type ProfileTarget } from "@/components/ren/profile-dialog"
import { useCatalog } from "@/hooks/use-catalog"
import { api } from "@/lib/api"
import { gaps } from "@/lib/apps"

function AddMenu(props: { placement: "home" | "chat"; onInsert: (text: string) => void; onAttach: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <InputGroupButton
            variant="outline"
            size="icon-sm"
            className={`rounded-full text-foreground data-popup-open:bg-secondary [&_svg]:transition-transform data-popup-open:[&_svg]:rotate-45 ${props.placement === "home" ? "size-10" : ""}`}
            aria-label="Add to this chat"
          />
        }
      >
        <IconPlus />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={props.onAttach}>
            <IconPaperclip className="text-foreground" />
            Attach files
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => props.onInsert("/")}>
            <IconTerminal2 className="text-foreground" />
            Commands
            <Kbd className="ml-auto">/</Kbd>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => props.onInsert("@")}>
            <IconAt className="text-foreground" />
            Apps
            <Kbd className="ml-auto">@</Kbd>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AppsStrip(props: { spaceId: string }) {
  const catalog = useCatalog()
  const [connecting, setConnecting] = useState<ProfileTarget>()
  const reach = useQuery({
    ...api["app-profile-reach"].space.profiles.queryOptions({ id: props.spaceId }),
    retry: false,
  })
  const profiles = (reach.data?.profiles ?? []).map((profile) => ({
    id: profile.id,
    appId: profile.appId,
    name: profile.name,
    app: catalog.appOf(profile.appId)?.name ?? profile.appSlug,
    icon: catalog.appOf(profile.appId)?.icon ?? undefined,
    gaps: gaps(profile),
  }))
  if (profiles.length === 0) return null
  const apps = [...new Map(profiles.map((profile) => [profile.app, profile.icon] as const))]
  const missing = profiles.filter((profile) => profile.gaps.length > 0).length
  return (
    <Popover>
      <PopoverTrigger
        render={
          <InputGroupButton
            size="sm"
            className="-ml-1"
            aria-label={`Apps: ${apps.map(([app]) => app).join(", ")}${missing ? `, ${missing} not connected` : ""}`}
          />
        }
      >
        <AvatarGroup className="-space-x-1 *:data-[slot=avatar]:ring-card">
          {apps.map(([app, icon]) => (
            <Avatar key={app} size="sm" className="data-[size=sm]:size-5">
              <AvatarImage src={icon} alt="" />
              <AvatarFallback className="bg-secondary">{app.charAt(0)}</AvatarFallback>
            </Avatar>
          ))}
        </AvatarGroup>
        {missing ? <Badge className="bg-chart-3 text-primary-foreground">{missing}</Badge> : null}
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 gap-0 p-1">
        <PopoverTitle className="sr-only">Apps this chat can use</PopoverTitle>
        {profiles.map((profile) => (
          <div key={profile.id} className="flex items-center gap-3 rounded-sm p-2">
            <Avatar size="sm" className="data-[size=sm]:size-5">
              <AvatarImage src={profile.icon} alt="" />
              <AvatarFallback className="bg-secondary">{profile.app.charAt(0)}</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm">
                {profile.app} · {profile.name}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {profile.gaps.length ? profile.gaps.join(", ") : "Connected"}
              </span>
            </div>
            {profile.gaps.length ? (
              <Button
                variant="secondary"
                size="xs"
                className="h-6.5"
                onClick={() => setConnecting({ appId: profile.appId, profileId: profile.id })}
              >
                Connect
              </Button>
            ) : null}
          </div>
        ))}
      </PopoverContent>
      {connecting ? <ProfileDialog {...connecting} onClose={() => setConnecting(undefined)} /> : null}
    </Popover>
  )
}

export type PromptInputBoot = Exclude<ChatSession.Boot, { readonly _tag: "Ready" }> | { readonly _tag: "Reconnecting" }

function PromptInputStatus(props: { boot: PromptInputBoot; onRetry?: (() => void) | undefined }) {
  if (props.boot._tag === "Failed")
    return (
      <span className="flex min-w-0 items-center gap-2 text-xs">
        <span className="truncate text-destructive">
          {props.boot.reason.split("\n").at(0)?.trim() || "The sandbox failed to start."}
        </span>
        <Button variant="link" size="xs" className="pointer-events-auto h-auto px-0" onClick={props.onRetry}>
          Retry
        </Button>
      </span>
    )
  if (props.boot._tag === "Reconnecting")
    return (
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <IconLoader2 className="size-3.5 animate-spin" />
        Reconnecting…
      </span>
    )
  return <BootLine />
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
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setIndex((current) => Math.min(current + 1, bootPhrases.length - 1)), 2400)
    return () => window.clearInterval(timer)
  }, [])
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

function SuggestionMenu(props: { suggest: Suggest; onChoose: (value: string) => void }) {
  const suggest = props.suggest
  const choose = props.onChoose
  return (
    <Command
      value={suggest.active ?? ""}
      shouldFilter={false}
      className="absolute inset-x-0 bottom-full mb-2 h-auto w-full rounded-xl border bg-popover shadow-md"
    >
      <CommandList className="max-h-72">
        <CommandGroup heading={suggest.label}>
          {suggest.items.map((item) => (
            <CommandItem
              key={item.value}
              value={item.value}
              onMouseDown={(event) => event.preventDefault()}
              onSelect={() => choose(item.value)}
            >
              {item.kind === "command" ? (
                <IconTerminal2 />
              ) : (
                <AppIcon name={item.label} icon={item.icon} size="sm" className="size-4 rounded-[3px] bg-transparent" />
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
      {props.sending ? (
        <IconLoader2 className="animate-spin" />
      ) : props.stop ? (
        <IconPlayerStopFilled />
      ) : (
        <IconArrowUp />
      )}
    </InputGroupButton>
  )
}

const textareaClass = (layout: { stacked: boolean; home: boolean; marked: boolean }) =>
  cn(
    layout.stacked
      ? cn("px-4 pt-4 leading-relaxed", layout.home ? "min-h-24" : "max-h-60 min-h-16")
      : "min-h-0 px-2 py-3 leading-relaxed",
    layout.marked && "text-transparent caret-foreground",
  )

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
}) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const attachments = useAttachments()
  const picker = useRef<HTMLInputElement>(null)
  const draft = props.value
  const booting = props.boot?._tag === "Starting"
  const text = draft.text
  const blank = Composer.isBlank(draft)
  const change = (next: Composer.Draft) => props.onChange(next)
  const [grown, setGrown] = useState(false)
  const submit = () => {
    if (props.sending || booting) return
    if (attachments.files.length > 0) {
      toast("Remove the attached files to send", { description: "Ren can’t receive files in chat yet." })
      return
    }
    if (blank) {
      if (props.running) props.onStop?.()
      return
    }
    setGrown(false)
    props.onSubmit()
  }
  const home = props.placement === "home"
  const stacked = home || grown || text.includes("\n") || draft.pasted.length > 0
  const status = props.boot && (blank || booting) ? props.boot : undefined
  const stop = props.running && blank && props.onStop
  const send = (
    <SendButton
      blank={blank}
      stop={Boolean(stop)}
      sending={props.sending === true}
      booting={booting || attachments.files.length > 0}
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
    change(Composer.withText(draft, result.text))
    place(result.text, result.cursor)
  }
  const suggest = props.suggest
  const marks = suggest?.marks(text) ?? []
  return (
    <div className="relative flex flex-col gap-2">
      {suggest?.open ? <SuggestionMenu suggest={suggest} onChoose={choose} /> : null}
      <DropOverlay onFiles={attachments.add} />
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          attachments.add([...(event.target.files ?? [])])
          event.target.value = ""
        }}
      />
      {attachments.files.length > 0 ? (
        <AttachmentChips files={attachments.files} onRemove={attachments.remove} />
      ) : null}
      {draft.pasted.length > 0 ? (
        <PastedBlocks
          pasted={draft.pasted}
          disabled={props.sending}
          onShow={(id) => change(Composer.showPasted(draft, id, text.length).draft)}
          onRemove={(id) => change(Composer.removePasted(draft, id))}
        />
      ) : null}
      <InputGroup
        className={stacked ? "rounded-xl bg-card dark:bg-card" : "h-12.25 rounded-full bg-card pl-1 dark:bg-card"}
      >
        {stacked ? null : (
          <InputGroupAddon>
            <AddMenu placement={props.placement} onInsert={insert} onAttach={() => picker.current?.click()} />
            {props.spaceId ? <AppsStrip spaceId={props.spaceId} /> : null}
            {status ? (
              <span className="ml-2">
                <PromptInputStatus boot={status} onRetry={props.onRetry} />
              </span>
            ) : null}
          </InputGroupAddon>
        )}
        {stacked && status ? (
          <span className="pointer-events-none absolute top-4 left-4 flex">
            <PromptInputStatus boot={status} onRetry={props.onRetry} />
          </span>
        ) : null}
        <MentionOverlay textarea={textarea} text={text} marks={marks} />
        <InputGroupTextarea
          value={text}
          onChange={(event) => {
            const next = event.target.value
            if (!next) setGrown(false)
            else if (!stacked && event.target.scrollHeight > 60) setGrown(true)
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
            if (kind === "attachment") attachments.add([...data.files])
            else change(Composer.addPasted(draft, { id: SessionMessage.ID.create(), text: pasted }))
          }}
          ref={textarea}
          onKeyDown={(event) => {
            if (suggest?.open && !event.nativeEvent.isComposing) {
              if ((event.key === "Enter" || event.key === "Tab") && suggest.active && !event.shiftKey) {
                event.preventDefault()
                choose(suggest.active)
                return
              }
              if (suggest.onKey({ key: event.key, ctrlKey: event.ctrlKey, isComposing: false })) {
                event.preventDefault()
                return
              }
            }
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
          readOnly={props.sending || booting}
          aria-busy={booting || undefined}
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the composer is the page’s one input, as in Ren
          autoFocus
          rows={1}
          className={textareaClass({ stacked, home, marked: marks.length > 0 })}
        />
        {stacked ? (
          <InputGroupAddon align="block-end" className="px-3 pt-0 pb-3">
            <AddMenu placement={props.placement} onInsert={insert} onAttach={() => picker.current?.click()} />
            {props.spaceId ? <AppsStrip spaceId={props.spaceId} /> : null}
            {props.model}
            {send}
          </InputGroupAddon>
        ) : (
          <InputGroupAddon align="inline-end" className="min-w-76 justify-end">
            {props.model}
            {send}
          </InputGroupAddon>
        )}
      </InputGroup>
    </div>
  )
}
