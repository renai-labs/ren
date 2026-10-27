import { useState, type ReactNode } from "react"
import { Composer, type ChatSession } from "@ren/chat"
import { SessionMessage } from "@ren/schema/session/message"
import { toast } from "sonner"
import { useQuery } from "@tanstack/react-query"
import {
  IconArrowUp,
  IconAt,
  IconClipboardText,
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
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarImage,
} from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ProfileDialog, type ProfileTarget } from "@/components/ren/profile-dialog"
import { useCatalog } from "@/hooks/use-catalog"
import { api } from "@/lib/api"
import { gaps } from "@/lib/apps"

function AddMenu(props: { placement: "home" | "chat"; onInsert: (text: string) => void }) {
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
      <DropdownMenuContent side="top" align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => props.onInsert("/")}>
            <IconTerminal2 />
            Run a command
            <DropdownMenuShortcut>/</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => props.onInsert("@")}>
            <IconAt />
            Mention an agent, skill or file
            <DropdownMenuShortcut>@</DropdownMenuShortcut>
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
  const apps = [
    ...new Map(profiles.map((profile) => [profile.app, profile.icon] as const)),
  ]
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
        {missing ? (
          <Badge className="bg-chart-3 text-primary-foreground">
            {missing}
          </Badge>
        ) : null}
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 gap-0 p-1">
        <PopoverTitle className="sr-only">Apps this chat can use</PopoverTitle>
        {profiles.map((profile) => (
          <div
            key={profile.id}
            className="flex items-center gap-3 rounded-sm p-2"
          >
            <Avatar size="sm" className="data-[size=sm]:size-5">
              <AvatarImage src={profile.icon} alt="" />
              <AvatarFallback className="bg-secondary">
                {profile.app.charAt(0)}
              </AvatarFallback>
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
          {props.boot.reason.split("\n").at(0)?.trim() ||
            "The sandbox failed to start."}
        </span>
        <Button
          variant="link"
          size="xs"
          className="pointer-events-auto h-auto px-0"
          onClick={props.onRetry}
        >
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
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground">
      <IconLoader2 className="size-3.5 animate-spin" />
      Starting sandbox…
    </span>
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
}) {
  const draft = props.value
  const text = draft.text
  const blank = Composer.isBlank(draft)
  const change = (next: Composer.Draft) => props.onChange(next)
  const submit = () => {
    if (props.sending) return
    if (blank) {
      if (props.running) props.onStop?.()
      return
    }
    props.onSubmit()
  }
  const home = props.placement === "home"
  const status = props.boot && blank ? props.boot : undefined
  const stop = props.running && blank && props.onStop
  const send = (
    <InputGroupButton
      variant={!blank || stop ? "default" : "secondary"}
      size="icon-sm"
      className="rounded-full"
      aria-label={stop ? "Stop" : "Send"}
      onClick={submit}
    >
      {props.sending ? <IconLoader2 className="animate-spin" /> : stop ? <IconPlayerStopFilled /> : <IconArrowUp />}
    </InputGroupButton>
  )
  const insert = (character: string) =>
    change(Composer.withText(draft, `${text}${text && !text.endsWith(" ") ? " " : ""}${character}`))
  return (
    <div className="flex flex-col gap-2">
      {draft.pasted.length > 0 ? (
        <PastedBlocks
          pasted={draft.pasted}
          disabled={props.sending}
          onShow={(id) => change(Composer.showPasted(draft, id, text.length).draft)}
          onRemove={(id) => change(Composer.removePasted(draft, id))}
        />
      ) : null}
    <InputGroup
      className={
        home
          ? "rounded-xl bg-card dark:bg-card"
          : "h-12.25 rounded-full bg-card pl-1 dark:bg-card"
      }
    >
      {home ? null : (
        <InputGroupAddon>
          <AddMenu placement={props.placement} onInsert={insert} />
          {props.spaceId ? <AppsStrip spaceId={props.spaceId} /> : null}
          {status ? (
            <span className="ml-2">
              <PromptInputStatus boot={status} onRetry={props.onRetry} />
            </span>
          ) : null}
        </InputGroupAddon>
      )}
      {home && status ? (
        <span className="pointer-events-none absolute top-4 left-4 flex">
          <PromptInputStatus boot={status} onRetry={props.onRetry} />
        </span>
      ) : null}
      <InputGroupTextarea
        value={text}
        onChange={(event) => change(Composer.withText(draft, event.target.value))}
        onPaste={(event) => {
          const data = event.clipboardData
          const pasted = data.getData("text/plain")
          const kind = Composer.paste(
            { types: [...data.types], kinds: [...data.items].map((item) => item.kind), text: pasted },
            { readClipboardImage: false },
          )
          if (kind === "text") return
          event.preventDefault()
          if (kind === "attachment") toast("Files can’t be attached yet")
          else change(Composer.addPasted(draft, { id: SessionMessage.ID.create(), text: pasted }))
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
          event.preventDefault()
          submit()
        }}
        placeholder={status ? "" : "Ask anything, @ to add context"}
        aria-label="Message"
        readOnly={props.sending}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the composer is the page’s one input, as in Ren
        autoFocus
        rows={1}
        className={
          home
            ? "min-h-24 px-4 pt-4 leading-relaxed"
            : "min-h-0 px-2 py-3 leading-relaxed"
        }
      />
      {home ? (
        <InputGroupAddon align="block-end" className="px-3 pt-0 pb-3">
          <AddMenu placement={props.placement} onInsert={insert} />
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
