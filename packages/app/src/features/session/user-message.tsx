import { createContext, use, useState } from "react"
import { Link } from "@tanstack/react-router"
import { cn } from "cn"
import { ChatState, Composer } from "@ren/chat"
import type { SessionMessage } from "@ren/schema/session/message"
import {
  IconChevronDown,
  IconChevronRight,
  IconClipboardText,
  IconClock,
  IconCopy,
  IconPencil,
  IconChecklist,
  IconWebhook,
} from "@tabler/icons-react"
import { Avatar, AvatarFallback, AvatarImage } from "@ren/ui/avatar"
import { Bubble, BubbleContent } from "@ren/ui/bubble"
import { Button } from "@ren/ui/button"
import { FileIcon } from "@ren/ui/file-icon"
import { QuoteCards } from "./quote.js"
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@ren/ui/attachment"
import { CodeBlock, CodeBlockContent } from "@ren/ui/code-block"
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@ren/ui/input-group"
import { Marker, MarkerContent, MarkerIcon } from "@ren/ui/marker"
import { Message, MessageAvatar, MessageContent, MessageFooter, MessageHeader } from "@ren/ui/message"
import { DriveFileCards } from "./attachments.js"
import { ImageLightbox } from "../../components/image-lightbox.js"
import { withAppMentions } from "@ren/ui/app-mention"
import { ChannelOrigin } from "./channel-origin.js"
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

function PastedChip(props: { text: string }) {
  const [open, setOpen] = useState(false)
  const lines = props.text.split("\n").length
  return (
    <div className="flex flex-col items-end gap-2">
      <Attachment size="sm">
        <AttachmentMedia>
          <IconClipboardText />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>Pasted text</AttachmentTitle>
          <AttachmentDescription className="tabular-nums">
            {lines === 1 ? "1 line" : `${lines} lines`}
          </AttachmentDescription>
        </AttachmentContent>
        <AttachmentTrigger aria-label={open ? "Hide pasted text" : "Show pasted text"} onClick={() => setOpen(!open)} />
      </Attachment>
      {open ? (
        <CodeBlock size="sm" className="w-full">
          <CodeBlockContent wrap className="max-h-64">
            {props.text}
          </CodeBlockContent>
        </CodeBlock>
      ) : null}
    </div>
  )
}

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
                <ImageLightbox
                  src={`data:${file.mime};base64,${file.data}`}
                  alt={file.name ?? "Image"}
                  className="size-full cursor-zoom-in"
                >
                  <img src={`data:${file.mime};base64,${file.data}`} alt={file.name ?? "Image"} />
                </ImageLightbox>
              </AttachmentMedia>
            ) : (
              <AttachmentMedia>
                <FileIcon name={file.name ?? ""} mime={file.mime} className="size-5" />
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
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground"
      aria-label="Copy"
      onClick={() => void navigator.clipboard.writeText(props.text)}
    >
      <IconCopy />
    </Button>
  )
}

function ScheduleOrigin(props: { schedule: NonNullable<SessionMessage.User["schedule"]> }) {
  return (
    <Marker className="justify-end text-xs">
      <MarkerIcon>
        <IconClock />
      </MarkerIcon>
      <MarkerContent>
        Scheduled ·{" "}
        <Link to="/schedules" search={{ schedule: props.schedule.scheduleId }}>
          {props.schedule.name}
        </Link>{" "}
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
              to="/spaces/$spaceId/webhooks/$webhookId"
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

function TypedBubble(props: { text: string; foldable: boolean; subject: string }) {
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
      <BubbleContent className="rounded-xl rounded-tr-lg px-4 py-2 text-base leading-[1.6]">
        <div className={cn(long && !open && "max-h-[12lh] overflow-clip mask-b-from-[calc(100%-(--spacing(10)))]")}>
          <div
            data-searchable=""
            data-quotable={props.subject}
            className="whitespace-pre-wrap"
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
            {withAppMentions(props.text, apps)}
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
          foldable={fold && !message.schedule && !message.webhook && !message.channel}
        />
      ) : null}
    </>
  )
}

const statusLabels: Partial<Record<ChatState.PendingStatus, string>> = {
  starting: "Pending",
  steering: "Pending",
  stranded: "Pending",
  unreachable: "Can’t reach Ren. Trying again…",
  unsent: "Not sent",
}

function UserFooter(props: {
  text: string
  status: ChatState.PendingStatus | undefined
  onEdit?: (() => void) | undefined
  onRetry?: (() => void) | undefined
  onRemove?: (() => void) | undefined
}) {
  const label = props.status && statusLabels[props.status]
  const unsent = props.status === "unsent"
  return (
    <MessageFooter className="justify-end gap-1">
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
    </MessageFooter>
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
        <MessageHeader className="px-0">{props.person.name}</MessageHeader>
        {props.message.schedule ? <ScheduleOrigin schedule={props.message.schedule} /> : null}
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
