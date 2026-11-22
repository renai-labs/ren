import { createContext, use, useState } from "react"
import { Link } from "@tanstack/react-router"
import { cn } from "cn"
import { ChatState, Composer, Mentions } from "@ren/chat"
import { MentionSources } from "@ren/client/react"
import type { SessionMessage } from "@ren/schema/session/message"
import {
  IconChevronDown,
  IconChevronRight,
  IconCheck,
  IconClock,
  IconCopy,
  IconPencil,
  IconChecklist,
  IconWebhook,
} from "@tabler/icons-react"
import { Avatar, AvatarFallback, AvatarImage } from "@ren/ui/avatar"
import { Bubble, BubbleContent } from "@ren/ui/bubble"
import { Button } from "@ren/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { FileIcon } from "@ren/ui/file-icon"
import { QuoteCards } from "./quote.js"
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@ren/ui/attachment"
import { CodeBlock, CodeBlockContent } from "@ren/ui/code-block"
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@ren/ui/input-group"
import { Marker, MarkerContent, MarkerIcon } from "@ren/ui/marker"
import { Message, MessageAvatar, MessageContent, MessageFooter, MessageHeader } from "@ren/ui/message"
import { DriveFileCards } from "./attachments.js"
import { ImageTrigger } from "../../components/image-set.js"
import { Markdown } from "../../components/markdown.js"
import type { Mentioned } from "../../components/markdown-link.js"
import { RouterContext } from "../../lib/router-context.js"
import { PastedChip } from "./pasted-chip.js"
import { TimeZone } from "../../lib/time-zone.js"
import { Platform } from "../../platform/platform.js"
import { formatInZone, formatTimeInZone } from "@ren/ui/time"
import { DateTime } from "effect"
import { ChannelOrigin } from "./channel-origin.js"
import { revealOnHover } from "./message-actions.js"
import { useMentionedApps } from "../../lib/use-app.js"
import { formatRun, localTimeZone } from "../../lib/schedules.js"

export interface Person {
  readonly name: string
  readonly image: string | undefined
}

const isPasteBlock = (text: string) => text.length >= 2000 || text.split("\n").length >= 20

function splitPasted(text: string, options: { fold: boolean }) {
  const separator = text.indexOf("\n\n")
  const head = separator === -1 ? text : text.slice(0, separator)
  const tail = separator === -1 ? "" : text.slice(separator + 2)
  if (tail && isPasteBlock(tail) && (options.fold || !isPasteBlock(head))) return { typed: head, pasted: tail }
  if (isPasteBlock(text)) return { typed: "", pasted: text }
  return { typed: text, pasted: undefined }
}

const foldAbove = 20

const Fold = createContext({ enabled: false, reveal: false })

function FileChips(props: { files: ReadonlyArray<SessionMessage.FileAttachment> }) {
  return (
    <AttachmentGroup className="max-w-full justify-end-safe">
      {props.files.map((file, index) => {
        const image = file.mime.startsWith("image/") && file.source.type === "inline" && file.data
        return (
          // oxlint-disable-next-line react/no-array-index-key -- two attachments can share a name and type
          <Attachment key={`${file.name ?? file.mime}-${index}`} size="sm">
            {image ? (
              <AttachmentMedia variant="image">
                <ImageTrigger
                  src={`data:${file.mime};base64,${file.data}`}
                  name={file.name ?? "Image"}
                  className="size-full cursor-zoom-in"
                >
                  <img src={`data:${file.mime};base64,${file.data}`} alt={file.name ?? "Image"} />
                </ImageTrigger>
              </AttachmentMedia>
            ) : (
              <AttachmentMedia>
                <FileIcon name={file.name ?? ""} mime={file.mime} />
              </AttachmentMedia>
            )}
            <AttachmentContent>
              <AttachmentTitle>{file.name ?? "Attachment"}</AttachmentTitle>
              <AttachmentDescription>{file.mime}</AttachmentDescription>
            </AttachmentContent>
          </Attachment>
        )
      })}
    </AttachmentGroup>
  )
}

function EditPrompt(props: { text: string; onCancel: () => void; onSave: (text: string) => void }) {
  const [text, setText] = useState(props.text)
  const save = () => {
    if (!text.trim() || text.trim() === props.text.trim()) props.onCancel()
    else props.onSave(text.trim())
  }
  return (
    <div className="flex flex-col gap-1.5">
      <InputGroup className="rounded-xl bg-card dark:bg-card">
        <InputGroupTextarea
          dir="auto"
          value={text}
          aria-label="Edit message"
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the editor opens because the person asked to edit
          autoFocus
          className="max-h-60 min-h-16 px-4 pt-3 text-base/relaxed"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") props.onCancel()
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
            event.preventDefault()
            save()
          }}
        />
        <InputGroupAddon align="block-end" className="justify-end gap-2 px-3 pt-0 pb-3">
          <Button variant="ghost" size="sm" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={save}>
            Send
          </Button>
        </InputGroupAddon>
      </InputGroup>
      <p className="px-1 text-xs text-muted-foreground">
        Sending replaces this message and removes everything after it.
      </p>
    </div>
  )
}

export function CopyButton(props: { text: string }) {
  const write = Platform.usePlatform().writeClipboardText
  const [copied, setCopied] = useState(false)
  if (!write) return null
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        data-copied={copied || undefined}
        className="text-muted-foreground data-copied:text-foreground"
        aria-label={copied ? "Copied" : "Copy"}
        onClick={() =>
          void write(props.text).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 2000)
          })
        }
      >
        <span
          key={String(copied)}
          className="flex animate-in duration-150 ease-out fade-in-0 zoom-in-75 motion-reduce:animate-none"
        >
          {copied ? <IconCheck /> : <IconCopy />}
        </span>
      </Button>
      <span aria-live="polite" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </>
  )
}

function ScheduleOrigin(props: {
  schedule: NonNullable<SessionMessage.User["schedule"]>
  spaceId: string | undefined
}) {
  return (
    <Marker className="justify-end text-xs">
      <MarkerIcon>
        <IconClock />
      </MarkerIcon>
      <MarkerContent>
        Scheduled ·{" "}
        {props.spaceId ? (
          <Link
            to="/spaces/$spaceId/automations/schedules/$scheduleId"
            params={{ spaceId: props.spaceId, scheduleId: props.schedule.scheduleId }}
          >
            {props.schedule.name}
          </Link>
        ) : (
          <Link to="/automations" search={{ schedule: props.schedule.scheduleId }}>
            {props.schedule.name}
          </Link>
        )}{" "}
        · {formatRun(props.schedule.scheduledAt, localTimeZone())}
      </MarkerContent>
    </Marker>
  )
}

function WebhookOrigin(props: { webhook: NonNullable<SessionMessage.User["webhook"]>; spaceId: string | undefined }) {
  return (
    <Marker className="justify-end text-xs">
      <MarkerIcon>
        <IconWebhook />
      </MarkerIcon>
      <MarkerContent>
        Webhook · {props.webhook.name} · {formatRun(props.webhook.receivedAt, localTimeZone())}
        {props.spaceId ? (
          <>
            {" · "}
            <Link
              to="/spaces/$spaceId/automations/webhooks/$webhookId"
              params={{ spaceId: props.spaceId, webhookId: props.webhook.webhookId }}
              search={{ tab: "requests", request: props.webhook.requestId }}
            >
              View request
            </Link>
          </>
        ) : null}
      </MarkerContent>
    </Marker>
  )
}

const requestStart = "\n\n<webhook_request>"

function WebhookRequest(props: { request: string }) {
  const [open, setOpen] = useState(false)
  const bytes = new TextEncoder().encode(props.request).length
  return (
    <div className="flex w-full max-w-md flex-col self-end overflow-hidden rounded-xl border bg-card text-sm">
      <Button
        variant="ghost"
        className="justify-start gap-2 rounded-none px-3.5"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        {open ? <IconChevronDown data-icon="inline-start" /> : <IconChevronRight data-icon="inline-start" />}
        Request
        <span className="text-muted-foreground">{bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`}</span>
      </Button>
      {open ? (
        <CodeBlock size="sm" className="rounded-none border-0">
          <CodeBlockContent wrap className="max-h-80">
            {props.request}
          </CodeBlockContent>
        </CodeBlock>
      ) : null}
    </div>
  )
}

function TaskHandoff(props: { task: NonNullable<SessionMessage.User["task"]> }) {
  const [open, setOpen] = useState(false)
  const rest = props.task.brief
  return (
    <div className="flex w-full max-w-md flex-col self-end overflow-hidden rounded-xl border bg-card text-sm">
      <div className="relative flex items-center gap-3 px-3.5 py-3 transition-colors duration-150 ease-out hover:bg-muted/50">
        <IconChecklist className="size-4.5 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-xs text-muted-foreground">
            Task assigned<span className="font-mono"> · {props.task.identifier}</span>
          </span>
          <Link
            to="/tasks/$taskId"
            params={{ taskId: props.task.taskId }}
            className="truncate font-medium after:absolute after:inset-0"
          >
            {props.task.title}
          </Link>
        </div>
        {rest ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="relative z-10 text-muted-foreground"
            aria-label={open ? "Hide the brief" : "Show the brief"}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <IconChevronDown className={cn("transition-transform duration-150 ease-out", open && "rotate-180")} />
          </Button>
        ) : null}
      </div>
      {open && rest ? (
        <p className="max-h-72 overflow-y-auto overscroll-contain border-t px-3.5 py-3 whitespace-pre-wrap text-muted-foreground">
          {rest}
        </p>
      ) : null}
    </div>
  )
}

function UserBody(props: { message: SessionMessage.User; spaceId: string | undefined; subject: string }) {
  if (props.message.task) return <TaskHandoff task={props.message.task} />
  const at = props.message.webhook ? props.message.text.indexOf(requestStart) : -1
  if (at >= 0)
    return (
      <>
        <UserText
          message={props.message}
          text={props.message.text.slice(0, at)}
          spaceId={props.spaceId}
          subject={props.subject}
        />
        <WebhookRequest request={props.message.text.slice(at + 2)} />
      </>
    )
  return (
    <UserText
      message={props.message}
      text={props.message.presentation?.displayText}
      spaceId={props.spaceId}
      subject={props.subject}
    />
  )
}

function TypedBubble(props: { text: string; foldable: boolean; subject: string; mentioned: ReadonlyArray<Mentioned> }) {
  const reveal = use(Fold).reveal
  const [open, setOpen] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [tall, setTall] = useState(() => props.text.split("\n").length > foldAbove)
  if (reveal !== revealed) {
    setRevealed(reveal)
    if (reveal) setOpen(true)
  }
  const apps = useMentionedApps(props.text)
  const long = props.foldable && tall
  return (
    <Bubble variant="muted" align="end">
      <BubbleContent dir="auto" className="min-w-0 rounded-xl rounded-tr-lg px-4 py-2 text-base leading-[1.6]">
        <div className={cn(long && !open && "max-h-[12lh] overflow-clip mask-b-from-[calc(100%-(--spacing(10)))]")}>
          <div
            data-searchable=""
            data-quotable={props.subject}
            ref={(node) => {
              if (!node || !props.foldable) return
              // ast-grep-ignore: no-manual-scroll -- measures a message to fold it, and scrolls nothing
              const observer = new ResizeObserver((entries) =>
                setTall(
                  (entries[0]?.contentRect.height ?? 0) >
                    foldAbove * Number.parseFloat(getComputedStyle(node).lineHeight),
                ),
              )
              observer.observe(node)
              return () => observer.disconnect()
            }}
          >
            <Markdown source="user" apps={apps} mentioned={props.mentioned} className="text-base leading-[1.6]">
              {props.text}
            </Markdown>
          </div>
        </div>
        {long ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-0 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent aria-expanded:text-muted-foreground aria-expanded:hover:text-foreground"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? "Show less" : "Read more"}
            <IconChevronDown
              data-icon="inline-end"
              className="transition-transform duration-150 ease-out group-aria-expanded/button:rotate-180 motion-reduce:transition-none"
            />
          </Button>
        ) : null}
      </BubbleContent>
    </Bubble>
  )
}

// oxlint-disable-next-line ren/no-comments -- What the composer sent for an agent, a skill or a repository, so the message shows each as the mention it was.
function useMentioned(message: SessionMessage.User, spaceId: string | undefined): ReadonlyArray<Mentioned> {
  const repositories = MentionSources.useRepositories(RouterContext.useRouterContext().api, spaceId)
  return [
    ...(message.agents ?? []).map((agent): Mentioned => ({
      text: agent.mention?.text ?? `@${agent.name}`,
      kind: "agent",
      label: agent.name,
    })),
    ...(message.skills ?? []).map((skill): Mentioned => ({
      text: skill.mention?.text ?? `@${skill.id}`,
      kind: "skill",
      label: skill.name,
    })),
    ...repositories.map((reference): Mentioned => ({
      text: `@${reference.alias}`,
      kind: "repository",
      label: Mentions.repositoryName(reference.repository),
    })),
  ]
}

function UserText(props: {
  message: SessionMessage.User
  text?: string | undefined
  spaceId: string | undefined
  subject: string
}) {
  const fold = use(Fold).enabled
  const parts = splitPasted(props.text ?? props.message.text, { fold })
  const message = props.message
  const files = props.message.files ?? []
  const uploads = props.message.uploads ?? []
  const mentioned = useMentioned(props.message, props.spaceId)
  return (
    <>
      {uploads.length > 0 ? (
        <DriveFileCards spaceId={props.spaceId} files={uploads} className="max-w-full justify-end-safe" />
      ) : null}
      {files.length > 0 ? <FileChips files={files} /> : null}
      {props.message.presentation ? <QuoteCards comments={props.message.presentation.comments} /> : null}
      {parts.pasted ? <PastedChip text={parts.pasted} /> : null}
      {parts.typed ? (
        <TypedBubble
          text={parts.typed}
          subject={props.subject}
          mentioned={mentioned}
          foldable={fold && !message.schedule && !message.webhook && !message.channel}
        />
      ) : null}
    </>
  )
}

const statusLabels: Partial<Record<ChatState.PendingStatus, string>> = {
  unreachable: "Can’t reach Ren. Trying again…",
  unsent: "Not sent",
}

function UserFooter(props: {
  text: string
  sentAt: string
  status: ChatState.PendingStatus | undefined
  onEdit?: (() => void) | undefined
  onRetry?: (() => void) | undefined
  onRemove?: (() => void) | undefined
}) {
  const platform = Platform.usePlatform()
  const timeZone = TimeZone.current(platform.storage)
  const label = props.status && statusLabels[props.status]
  const unsent = props.status === "unsent"
  return (
    <MessageFooter className="justify-end gap-1 px-0">
      {label ? (
        <span className={cn("px-1 text-xs", unsent ? "text-destructive" : "text-muted-foreground")}>{label}</span>
      ) : null}
      {unsent && props.onRetry ? (
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={props.onRetry}>
          Retry
        </Button>
      ) : null}
      {unsent && props.onRemove ? (
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={props.onRemove}>
          Remove
        </Button>
      ) : null}
      <span className={cn("-mr-1.25 flex items-center gap-1", revealOnHover)}>
        <time
          dateTime={props.sentAt}
          title={formatInZone(props.sentAt, timeZone)}
          className="px-1 font-normal tabular-nums"
        >
          {formatTimeInZone(props.sentAt, timeZone)}
        </time>
        {props.onEdit ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label="Edit"
            onClick={props.onEdit}
          >
            <IconPencil />
          </Button>
        ) : null}
        <CopyButton text={props.text} />
      </span>
    </MessageFooter>
  )
}

function QueuedMark() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users reach the tooltip that explains the icon
            tabIndex={0}
            className="flex animate-in rounded-sm duration-200 ease-out fade-in-0 outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:animate-none"
          />
        }
      >
        <IconClock aria-hidden className="size-3.5" />
        <span className="sr-only">Queued</span>
      </TooltipTrigger>
      <TooltipContent>Queued. Ren reads it after the current step.</TooltipContent>
    </Tooltip>
  )
}

export function UserMessage(props: {
  message: SessionMessage.User
  spaceId: string | undefined
  fold: boolean
  reveal: boolean
  person: Person
  status: ChatState.PendingStatus | undefined
  editing: boolean
  onEdit?: (() => void) | undefined
  onRetry?: (() => void) | undefined
  onRemove?: (() => void) | undefined
  onCancel: () => void
  onSave: (text: string) => void
}) {
  return (
    <Message
      align="end"
      data-turn={props.message.id}
      className={cn("scroll-mt-16", props.editing ? "w-full @transcript:-mr-13.5" : "w-auto @transcript:-mr-13.5")}
    >
      <MessageAvatar className="ml-3.5">
        <Avatar size="sm">
          {props.person.image ? <AvatarImage src={props.person.image} alt="" /> : null}
          <AvatarFallback>{props.person.name.charAt(0)}</AvatarFallback>
        </Avatar>
      </MessageAvatar>
      <MessageContent className={props.editing ? "w-full" : undefined}>
        <MessageHeader className="gap-1.5 px-0">
          {props.status === "steering" ? <QueuedMark /> : null}
          {props.person.name}
        </MessageHeader>
        {props.message.schedule ? <ScheduleOrigin schedule={props.message.schedule} spaceId={props.spaceId} /> : null}
        {props.message.webhook ? <WebhookOrigin webhook={props.message.webhook} spaceId={props.spaceId} /> : null}
        {props.message.channel ? <ChannelOrigin origin={props.message.channel} /> : null}
        {props.editing ? (
          <EditPrompt
            text={props.message.presentation?.displayText ?? props.message.text}
            onCancel={props.onCancel}
            onSave={props.onSave}
          />
        ) : (
          <Fold value={{ enabled: props.fold, reveal: props.reveal }}>
            <UserBody message={props.message} spaceId={props.spaceId} subject={`${props.person.name}'s message`} />
            <UserFooter
              text={Composer.copyText(props.message)}
              sentAt={DateTime.formatIso(props.message.time.created)}
              status={props.status}
              onEdit={props.onEdit}
              onRetry={props.onRetry}
              onRemove={props.onRemove}
            />
          </Fold>
        )}
      </MessageContent>
    </Message>
  )
}
