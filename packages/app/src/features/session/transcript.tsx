import { DateTime, Option } from "effect"
import { flushSync } from "react-dom"
import {
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type TouchEvent,
  type UIEvent,
  type WheelEvent,
} from "react"
import {
  AppConnect,
  ChannelReply,
  ChatState,
  PatchFiles,
  Projection,
  ShownFile,
  TimelineRow,
  TimelineText,
  ToolDisplay,
  ToolState,
  type ChatAtoms,
} from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Link } from "@tanstack/react-router"
import { cn } from "cn"
import { AppConnectCard } from "./app-connect.js"
import { Channel } from "@ren/schema/channel"
import { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import type { Shell } from "@ren/schema/shell"
import {
  IconBrain,
  IconChevronDown,
  IconChevronRight,
  IconClipboardText,
  IconClock,
  IconCopy,
  IconFile,
  IconInfoCircle,
  IconPencil,
  IconChecklist,
  IconWebhook,
} from "@tabler/icons-react"
import { AsyncResult } from "effect/reactivity"
import { Avatar, AvatarFallback, AvatarImage } from "@ren/ui/avatar"
import { Bubble, BubbleContent } from "@ren/ui/bubble"
import { Button } from "@ren/ui/button"
import { FindBar, type FindBarProps } from "@ren/ui/find-bar"
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@ren/ui/attachment"
import { CodeBlock, CodeBlockContent, CodeBlockHeader, CodeBlockLine, CodeBlockTitle } from "@ren/ui/code-block"
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@ren/ui/input-group"
import { Marker, MarkerContent, MarkerIcon } from "@ren/ui/marker"
import { Message, MessageAvatar, MessageContent, MessageFooter, MessageHeader } from "@ren/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@ren/ui/message-scroller"
import { Spinner } from "@ren/ui/spinner"
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@ren/ui/trace"
import { DriveFileCards } from "./attachments.js"
import { Markdown } from "../../components/markdown.js"
import { toolIcons } from "./tool-icons.js"
import { TurnProblem, TurnRetrying } from "./turn-problem.js"
import { useSubagentCard } from "./chat-view.js"
import { providerLabel, type ProblemHandlers } from "./turn-problems.js"
import { MessagesSkeleton } from "../../components/chat-skeleton.js"
import { EmptyState } from "../../components/empty-state.js"
import { ImageLightbox } from "../../components/image-lightbox.js"
import { withAppMentions } from "@ren/ui/app-mention"
import { ChannelMark } from "../../components/channel-mark.js"
import { ChannelOrigin } from "./channel-origin.js"
import { useMentionedApps } from "../../lib/use-app.js"
import type { CatalogApp } from "../../lib/apps.js"
import { useSmoothText } from "../../lib/use-smooth-text.js"
import { formatRun, localTimeZone } from "../../lib/schedules.js"
import { WorkspaceImage } from "./workspace-image.js"
import { FileMentions, WorkspaceFileChip } from "./file-mention.js"
import { dirsOf, isPath } from "./file-paths.js"

interface Person {
  readonly name: string
  readonly image: string | undefined
}

export interface TranscriptProps {
  readonly view: ChatAtoms.View
  readonly spaceId?: string | undefined
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly rows: ReadonlyArray<TimelineRow.Row>
  readonly activeMessageID: string | undefined
  readonly busy: boolean
  readonly working: boolean
  readonly statuses: ReadonlyMap<string, ChatState.PendingStatus>
  readonly viewer: Person & { readonly id: string }
  readonly people: ReadonlyMap<string, Person>
  readonly more: boolean
  readonly loading?: boolean | undefined
  readonly loadingHistory: boolean
  readonly onLoadMore: () => void
  readonly find?: FindBarProps | undefined
  readonly onOpenChild: (sessionID: Session.ID) => void
  readonly onEdit?: ((message: SessionMessage.User, text: string) => void) | undefined
  readonly expanded?: boolean | undefined
  readonly modelNames?: ReadonlyMap<string, string> | undefined
  readonly empty?: string | undefined
  readonly admin?: boolean | undefined
  readonly onTryAgain?: ((text: string) => void) | undefined
  readonly onContinue?: (() => void) | undefined
  readonly onChangeModel?: (() => void) | undefined
  readonly onStop?: (() => void) | undefined
}

type Step =
  | {
      readonly kind: "reasoning"
      readonly key: string
      readonly content: SessionMessage.Reasoning
      readonly running: boolean
    }
  | { readonly kind: "tool"; readonly key: string; readonly tool: SessionMessage.Tool }
  | { readonly kind: "shell"; readonly key: string; readonly message: SessionMessage.Shell }
  | { readonly kind: "notice"; readonly key: string; readonly message: SessionMessage.Info }
  | { readonly kind: "text"; readonly key: string; readonly text: string; readonly streaming: boolean }

type Block =
  | { readonly kind: "user"; readonly key: string; readonly message: SessionMessage.User }
  | { readonly kind: "steps"; readonly key: string; readonly turn: string; readonly steps: Step[] }
  | {
      readonly kind: "answer"
      readonly key: string
      readonly turn: string
      readonly text: string
      readonly streaming: boolean
    }
  | { readonly kind: "reply"; readonly key: string; readonly tool: SessionMessage.Tool }
  | { readonly kind: "file"; readonly key: string; readonly file: SessionMessage.DriveFile }
  | {
      readonly kind: "connect"
      readonly key: string
      readonly connects: ReadonlyArray<{ readonly appId: string; readonly spaceId: string }>
    }
  | { readonly kind: "row"; readonly key: string; readonly row: TimelineRow.Row }

const streaming = (message: SessionMessage.Info | undefined) => message?.type === "assistant" && !message.time.completed

function stepsOf(row: TimelineRow.Row, byId: ReadonlyMap<string, SessionMessage.Info>): Step[] | undefined {
  if (row._tag === "Thinking") {
    const content = Projection.resolveContent(byId.get(row.ref.messageID), row.ref.partID)
    return content?.type === "reasoning"
      ? [{ kind: "reasoning", key: TimelineRow.key(row), content, running: true }]
      : []
  }
  if (row._tag === "Shell") {
    const message = byId.get(row.messageID)
    return message?.type === "shell" ? [{ kind: "shell", key: TimelineRow.key(row), message }] : []
  }
  if (row._tag !== "AssistantPart") return undefined
  const group = row.group
  const refs = group.type === "part" ? [group.ref] : group.refs
  return refs.flatMap((reference): Step[] => {
    const message = byId.get(reference.messageID)
    const key = `${reference.messageID}:${reference.partID}`
    if (reference.partID === reference.messageID) {
      if (message?.type === "shell") return [{ kind: "shell", key, message }]
      return message ? [{ kind: "notice", key, message }] : []
    }
    const content = Projection.resolveContent(message, reference.partID)
    if (content?.type === "reasoning")
      return [{ kind: "reasoning", key, content, running: streaming(message) && !content.time?.completed }]
    if (content?.type === "tool") return ToolDisplay.hidden(content) ? [] : [{ kind: "tool", key, tool: content }]
    return []
  })
}

function partBlock(row: TimelineRow.Row, byId: ReadonlyMap<string, SessionMessage.Info>): Block | undefined {
  if (row._tag !== "AssistantPart" || row.group.type !== "part") return undefined
  const message = byId.get(row.group.ref.messageID)
  const content = Projection.resolveContent(message, row.group.ref.partID)
  if (content?.type === "text")
    return {
      kind: "answer",
      key: TimelineRow.key(row),
      turn: row.userMessageID,
      text: content.text,
      streaming: streaming(message),
    }
  return content?.type === "tool" ? toolBlock(content, TimelineRow.key(row)) : undefined
}

function toolBlock(content: SessionMessage.Tool, key: string): Block | undefined {
  if (ChannelReply.shown(content)) return { kind: "reply", key, tool: content }
  const connects = AppConnect.of(content)
  if (connects.length > 0) return { kind: "connect", key, connects }
  const shown = Option.getOrUndefined(ShownFile.of(content))
  return shown && { kind: "file", key, file: shown }
}

function pushSteps(blocks: Block[], key: string, turn: string, steps: Step[]) {
  const last = blocks.at(-1)
  if (last?.kind === "steps" && last.turn === turn) last.steps.push(...steps)
  else if (steps.length > 0) blocks.push({ kind: "steps", key, turn, steps })
}

function blocksOf(rows: ReadonlyArray<TimelineRow.Row>, byId: ReadonlyMap<string, SessionMessage.Info>) {
  return rows.reduce<Block[]>((blocks, row) => {
    if (row._tag === "TurnGap") return blocks
    if (row._tag === "UserMessage") {
      const message = byId.get(row.userMessageID)
      if (message?.type === "user") blocks.push({ kind: "user", key: TimelineRow.key(row), message })
      return blocks
    }
    const part = partBlock(row, byId)
    const steps = part ? undefined : stepsOf(row, byId)
    if (part) blocks.push(part)
    else if (steps) pushSteps(blocks, TimelineRow.key(row), row.userMessageID, steps)
    else blocks.push({ kind: "row", key: TimelineRow.key(row), row })
    return blocks
  }, [])
}

function groupTurns(blocks: ReadonlyArray<Block>, live: (turn: string) => boolean) {
  const lastSteps = new Map(
    blocks.flatMap((block, index) => (block.kind === "steps" ? [[block.turn, index] as const] : [])),
  )
  return blocks.reduce<Block[]>((grouped, block, index) => {
    if (block.kind !== "steps" && block.kind !== "answer") {
      grouped.push(block)
      return grouped
    }
    if (block.kind === "answer" && (live(block.turn) || (lastSteps.get(block.turn) ?? -1) < index)) {
      grouped.push(block)
      return grouped
    }
    const items: Step[] =
      block.kind === "steps"
        ? block.steps
        : [{ kind: "text", key: block.key, text: block.text, streaming: block.streaming }]
    const group = live(block.turn)
      ? grouped.find((each) => each.kind === "steps" && each.turn === block.turn)
      : grouped.at(-1)
    if (group?.kind === "steps" && group.turn === block.turn) group.steps.push(...items)
    else grouped.push({ kind: "steps", key: block.key, turn: block.turn, steps: [...items] })
    return grouped
  }, [])
}

const isPasteBlock = (text: string) => text.length >= 2000 || text.split("\n").length >= 20

function splitPasted(text: string) {
  const separator = text.indexOf("\n\n")
  const head = separator === -1 ? text : text.slice(0, separator)
  const tail = separator === -1 ? "" : text.slice(separator + 2)
  if (tail && isPasteBlock(tail) && !isPasteBlock(head)) return { typed: head, pasted: tail }
  if (isPasteBlock(text)) return { typed: "", pasted: text }
  return { typed: text, pasted: undefined }
}

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
                <IconFile />
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

function CopyButton(props: { text: string }) {
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

function UserBody(props: { message: SessionMessage.User; spaceId: string | undefined; root: Session.ID }) {
  if (props.message.task) return <TaskHandoff task={props.message.task} />
  const at = props.message.webhook ? props.message.text.indexOf(requestStart) : -1
  if (at >= 0)
    return (
      <>
        <UserText
          message={props.message}
          text={props.message.text.slice(0, at)}
          spaceId={props.spaceId}
          root={props.root}
        />
        <WebhookRequest request={props.message.text.slice(at + 2)} />
      </>
    )
  return <UserText message={props.message} spaceId={props.spaceId} root={props.root} />
}

function UserText(props: {
  message: SessionMessage.User
  text?: string
  spaceId: string | undefined
  root: Session.ID
}) {
  const parts = splitPasted(props.text ?? props.message.text)
  const apps = useMentionedApps(parts.typed)
  const files = props.message.files ?? []
  const uploads = props.message.uploads ?? []
  return (
    <>
      {uploads.length > 0 ? (
        <DriveFileCards spaceId={props.spaceId} files={uploads} className="max-w-full justify-end-safe" />
      ) : null}
      {files.length > 0 ? <FileChips files={files} /> : null}
      {parts.pasted ? <PastedChip text={parts.pasted} /> : null}
      {parts.typed ? (
        <Bubble variant="muted" align="end">
          <BubbleContent
            data-searchable=""
            className="rounded-xl rounded-tr-lg px-4 py-2 text-base leading-[1.6] whitespace-pre-wrap"
          >
            <FileMentions text={parts.typed} root={props.root} plain={(text) => withAppMentions(text, apps)} />
          </BubbleContent>
        </Bubble>
      ) : null}
    </>
  )
}

function UserFooter(props: { text: string; pending: boolean; onEdit?: (() => void) | undefined }) {
  return (
    <MessageFooter className="justify-end gap-1">
      {props.pending ? <span className="px-1 text-xs text-muted-foreground">Pending</span> : null}
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

function UserMessage(props: {
  message: SessionMessage.User
  spaceId: string | undefined
  root: Session.ID
  person: Person
  pending: boolean
  editing: boolean
  onEdit?: (() => void) | undefined
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
          <EditPrompt text={props.message.text} onCancel={props.onCancel} onSave={props.onSave} />
        ) : (
          <>
            <UserBody message={props.message} spaceId={props.spaceId} root={props.root} />
            <UserFooter text={props.message.text} pending={props.pending} onEdit={props.onEdit} />
          </>
        )}
      </MessageContent>
    </Message>
  )
}

function ChannelReplyMessage(props: { tool: SessionMessage.Tool }) {
  const reply = ChannelReply.of(props.tool)
  return (
    <Message>
      <MessageContent>
        <Marker className="text-xs">
          {reply.sent ? (
            <MarkerIcon>
              <ChannelMark provider={reply.sent.provider} className="size-4" />
            </MarkerIcon>
          ) : null}
          <MarkerContent>
            {reply.sent ? `Sent on ${Channel.titles[reply.sent.provider]}` : "Sending to the thread…"}
          </MarkerContent>
        </Marker>
        <Bubble variant="ghost">
          <BubbleContent className="text-base leading-[1.7]">
            <Markdown className="text-base leading-[1.7]">{reply.text}</Markdown>
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}

function Output(props: { text: string; failed?: boolean | undefined }) {
  return (
    <CodeBlock size="sm" variant={props.failed ? "destructive" : "default"}>
      <CodeBlockContent wrap className="max-h-64">
        {props.text}
      </CodeBlockContent>
    </CodeBlock>
  )
}

const traceStatus = (state: { running?: boolean | undefined; failed?: boolean | undefined }) => {
  if (state.running) return "running"
  return state.failed ? "error" : undefined
}

function Expandable(props: { content: ReactNode; className?: string | undefined; children: ReactNode }) {
  if (!props.content) return props.children
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>{props.children}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent className={props.className}>{props.content}</TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

function StepDetail(props: {
  output: string | undefined
  failed: boolean | undefined
  images: ReadonlyArray<SessionMessage.ToolFileContent>
}) {
  const images = props.images
  return (
    <>
      {images.map((image) => (
        <ImageLightbox key={image.uri} src={image.uri} alt={image.name?.split("/").at(-1) ?? "Image"}>
          <img
            src={image.uri}
            alt={image.name ?? "Image"}
            className="max-h-64 w-fit max-w-full rounded-md border bg-muted object-contain"
          />
        </ImageLightbox>
      ))}
      {props.output && !(images.length > 0 && props.output === "Image read successfully") ? (
        <Output text={props.output} failed={props.failed} />
      ) : null}
    </>
  )
}

function StepRow(props: {
  icon: ReactNode
  verb: string
  subject?: string | undefined
  running?: boolean
  failed?: boolean
  output?: string | undefined
  images?: ReadonlyArray<SessionMessage.ToolFileContent> | undefined
}) {
  const images = props.images ?? []
  const detail =
    props.output || images.length > 0 ? (
      <StepDetail output={props.output} failed={props.failed} images={images} />
    ) : undefined
  return (
    <Trace>
      <Expandable content={detail} className="flex flex-col gap-2">
        <TraceLine status={traceStatus(props)}>
          <TraceIcon>{props.running ? <Spinner /> : props.icon}</TraceIcon>
          <TraceTitle className="shrink-0">{props.verb}</TraceTitle>
          {props.subject ? (
            <TraceDescription className="min-w-0 shrink truncate font-mono text-xs">{props.subject}</TraceDescription>
          ) : null}
        </TraceLine>
      </Expandable>
    </Trace>
  )
}

const lineVariant = (type: string) => {
  if (type === "addition") return "added"
  return type === "deletion" ? "removed" : "default"
}

function FileDiff(props: { file: PatchFiles.File; titled: boolean }) {
  return (
    <CodeBlock size="sm">
      {props.titled ? (
        <CodeBlockHeader>
          <CodeBlockTitle>{props.file.path}</CodeBlockTitle>
        </CodeBlockHeader>
      ) : null}
      <CodeBlockContent wrap className="max-h-64">
        {props.file.view.diff.hunks
          .flatMap((hunk) => hunk.lines)
          .map((line, index) => (
            // oxlint-disable-next-line react/no-array-index-key -- diff lines have no identity besides their place
            <CodeBlockLine key={index} variant={lineVariant(line.type)}>
              {line.text.replace(/\n$/u, "")}
            </CodeBlockLine>
          ))}
      </CodeBlockContent>
    </CodeBlock>
  )
}

function DiffStep(props: { tool: SessionMessage.Tool; icon: ReactNode; files: ReadonlyArray<PatchFiles.File> }) {
  const additions = props.files.reduce((total, file) => total + file.additions, 0)
  const deletions = props.files.reduce((total, file) => total + file.deletions, 0)
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>{props.icon}</TraceIcon>
            <TraceTitle className="shrink-0">{ToolDisplay.label(props.tool)}</TraceTitle>
            <TraceDescription className="min-w-0 shrink truncate font-mono text-xs">
              {ToolDisplay.subtitle(props.tool)}
            </TraceDescription>
            <TraceDescription>
              +{additions} −{deletions}
            </TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="flex flex-col gap-2">
          {props.files.map((file) => (
            <FileDiff key={file.path} file={file} titled={props.files.length > 1} />
          ))}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}

function LiveShell(props: { tool: SessionMessage.Tool; view: ChatAtoms.View; shellID: Shell.ID }) {
  const pending = props.tool.state.status === "streaming" || props.tool.state.status === "running"
  const live = ChatReact.useShellRunning(props.view.root, props.shellID)
  const running = pending || live
  const streamed = AsyncResult.getOrElse(
    ChatReact.useShellOutput({ ...props.view, shellID: props.shellID, running }),
    () => "",
  )
  const failed = !running && ToolDisplay.status(props.tool) === "failed"
  return (
    <StepRow
      icon={<toolIcons.command />}
      verb={ToolDisplay.label(props.tool)}
      subject={ToolDisplay.subtitle(props.tool)}
      running={running}
      failed={failed}
      output={streamed ? TimelineText.shellOutput(streamed) : ToolDisplay.output(props.tool)}
    />
  )
}

type Card = ReturnType<typeof useSubagentCard>

function subagentTitle(card: Card) {
  if (card.needsInput) return "Needs your input"
  if (card.status === "failed") return "Failed to delegate"
  return card.status === "running" || card.status === "delegating" ? "Delegating" : "Delegated"
}

function subagentState(card: Card, tool: SessionMessage.Tool) {
  const failed = card.status === "failed"
  return {
    child: card.child?.startsWith("ses_") ? Session.ID.make(card.child) : undefined,
    running: card.status === "running" || card.status === "delegating",
    failed,
    error: failed ? (ToolDisplay.error(tool) ?? ToolDisplay.output(tool)) : undefined,
  }
}

function SubagentError(props: { error: string; onOpen: (() => void) | undefined }) {
  return (
    <>
      <Output text={props.error} failed />
      {props.onOpen ? (
        <Button variant="link" size="sm" className="px-0" onClick={props.onOpen}>
          Open subagent
        </Button>
      ) : null}
    </>
  )
}

function Opener(props: { label: string; onOpen: (() => void) | undefined; children: ReactNode }) {
  if (!props.onOpen) return props.children
  return (
    // oxlint-disable-next-line react/forbid-elements -- the whole trace line opens the subagent, and Trace styles its button
    <button type="button" aria-label={props.label} onClick={props.onOpen}>
      {props.children}
    </button>
  )
}

function SubagentStep(props: {
  tool: SessionMessage.Tool
  view: ChatAtoms.View
  onOpenChild: (id: Session.ID) => void
}) {
  const card = useSubagentCard(props.view, props.tool)
  const state = subagentState(card, props.tool)
  const child = state.child
  const open = child ? () => props.onOpenChild(child) : undefined
  const error = state.error
  const running = state.running
  return (
    <Trace>
      <Opener label={`Open ${card.title}`} onOpen={error ? undefined : open}>
        <Expandable
          content={error ? <SubagentError error={error} onOpen={open} /> : undefined}
          className="flex flex-col items-start gap-2"
        >
          <TraceLine status={traceStatus(state)}>
            <TraceIcon>{running ? <Spinner /> : <toolIcons.agent />}</TraceIcon>
            <TraceTitle className="shrink-0">{subagentTitle(card)}</TraceTitle>
            <TraceDescription className="min-w-0 shrink truncate">{card.description ?? card.title}</TraceDescription>
            {card.activity && running ? (
              <TraceDescription className="min-w-0 shrink truncate font-mono text-xs">{card.activity}</TraceDescription>
            ) : null}
            {open && !error ? (
              <TraceIcon>
                <IconChevronRight />
              </TraceIcon>
            ) : null}
          </TraceLine>
        </Expandable>
      </Opener>
    </Trace>
  )
}

function ToolStep(props: { tool: SessionMessage.Tool; view: ChatAtoms.View; onOpenChild: (id: Session.ID) => void }) {
  const tool = props.tool
  const shellID = ToolState.liveShellID(tool)
  if (shellID) return <LiveShell tool={tool} view={props.view} shellID={shellID} />
  const status = ToolDisplay.status(tool)
  const error = ToolDisplay.error(tool)
  const Icon = toolIcons[ToolDisplay.kind(tool)]
  if (tool.name === "subagent" || tool.name === "task")
    return <SubagentStep tool={tool} view={props.view} onOpenChild={props.onOpenChild} />
  const changed =
    PatchFiles.isFileChange(tool) && status === "completed" ? PatchFiles.patchFiles(PatchFiles.toolFiles(tool)) : []
  if (changed.length > 0) return <DiffStep tool={tool} icon={<Icon />} files={changed} />
  return (
    <StepRow
      icon={<Icon />}
      verb={ToolDisplay.label(tool)}
      subject={[ToolDisplay.subtitle(tool), ToolDisplay.matches(tool)].filter(Boolean).join(" · ") || undefined}
      running={status === "running"}
      failed={status === "failed"}
      output={error ?? ToolDisplay.output(tool)}
      images={
        "content" in tool.state
          ? tool.state.content.filter(
              (item): item is SessionMessage.ToolFileContent => item.type === "file" && item.mime.startsWith("image/"),
            )
          : []
      }
    />
  )
}

function ReasoningStep(props: { step: Extract<Step, { kind: "reasoning" }> }) {
  const text = props.step.content.text.trim()
  return (
    <Trace>
      <Expandable content={text ? <Markdown className="text-sm/relaxed">{text}</Markdown> : undefined}>
        <TraceLine status={props.step.running ? "running" : undefined}>
          <TraceIcon>
            <IconBrain />
          </TraceIcon>
          <TraceTitle>{props.step.running ? "Thinking" : "Thought"}</TraceTitle>
        </TraceLine>
      </Expandable>
    </Trace>
  )
}

function ShellStep(props: { message: SessionMessage.Shell }) {
  const message = props.message
  const error = TimelineText.shellError(message)
  return (
    <StepRow
      icon={<toolIcons.command />}
      verb={message.status === "running" ? "Running" : "Ran"}
      subject={message.command}
      running={message.status === "running"}
      failed={Boolean(error)}
      output={message.output?.output ? TimelineText.shellOutput(message.output.output) : (error ?? "No output")}
    />
  )
}

function NoticeStep(props: { message: SessionMessage.Info }) {
  const notice = TimelineText.notice(props.message)
  if (!notice) return null
  return (
    <Trace>
      <TraceLine>
        <TraceIcon>
          <IconInfoCircle />
        </TraceIcon>
        <TraceTitle>{notice.title}</TraceTitle>
        {notice.detail ? (
          <TraceDescription className="min-w-0 shrink truncate">{notice.detail}</TraceDescription>
        ) : null}
      </TraceLine>
    </Trace>
  )
}

function StepItem(props: { step: Step; view: ChatAtoms.View; onOpenChild: (id: Session.ID) => void }) {
  const step = props.step
  if (step.kind === "reasoning") return <ReasoningStep step={step} />
  if (step.kind === "tool") return <ToolStep tool={step.tool} view={props.view} onOpenChild={props.onOpenChild} />
  if (step.kind === "text") return null
  if (step.kind === "shell") return <ShellStep message={step.message} />
  return <NoticeStep message={step.message} />
}

function workedLabel(props: { running: boolean; workedFor: string | undefined }) {
  if (props.running) return "Working"
  return props.workedFor ? `Worked for ${props.workedFor}` : "Worked"
}

function Steps(props: {
  expanded?: boolean | undefined
  steps: ReadonlyArray<Step>
  workedFor: string | undefined
  running: boolean
  view: ChatAtoms.View
  onOpenChild: (id: Session.ID) => void
}) {
  const count = props.steps.filter((step) => step.kind !== "text").length
  const runs = props.steps.reduce<Array<{ key: string; text?: Extract<Step, { kind: "text" }>; steps: Step[] }>>(
    (all, step) => {
      const last = all.at(-1)
      if (step.kind === "text") all.push({ key: step.key, text: step, steps: [] })
      else if (last && !last.text) last.steps.push(step)
      else all.push({ key: step.key, steps: [step] })
      return all
    },
    [],
  )
  return (
    <Trace>
      <TraceCollapsible defaultOpen={props.expanded === true}>
        <TraceCollapsibleTrigger>
          <TraceLine status={props.running ? "running" : undefined}>
            <TraceIcon>
              <IconClock />
            </TraceIcon>
            <TraceTitle>{workedLabel(props)}</TraceTitle>
            <TraceDescription>{count === 1 ? "1 step" : `${count} steps`}</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="flex flex-col gap-3">
          {runs.map((run) =>
            run.text ? (
              <SmoothMarkdown
                key={run.key}
                text={run.text.text}
                streaming={run.text.streaming}
                className="text-sm/relaxed text-foreground"
              />
            ) : (
              <Trace key={run.key}>
                {run.steps.map((step) => (
                  <StepItem key={step.key} step={step} view={props.view} onOpenChild={props.onOpenChild} />
                ))}
              </Trace>
            ),
          )}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}

function ErrorRow(props: { row: Extract<TimelineRow.Row, { _tag: "Error" }>; context: Context }) {
  const row = props.row
  const assistants = props.context.turns.get(row.userMessageID) ?? []
  const last = assistants.at(-1)
  return (
    <TurnProblem
      kind={row.kind}
      text={row.text}
      provider={providerLabel(last?.model.providerID ?? "the model provider")}
      model={last ? (props.context.modelNames.get(last.model.id) ?? last.model.id) : "This model"}
      midTurn={assistants.some((message) => message.content.some((content) => content.type === "tool"))}
      admin={props.context.admin}
      handlers={props.context.handlers(row.userMessageID)}
    />
  )
}

function RetryRow(props: { row: Extract<TimelineRow.Row, { _tag: "Retry" }>; context: Context }) {
  const row = props.row
  if (props.context.activeMessageID !== row.userMessageID) return null
  const last = (props.context.turns.get(row.userMessageID) ?? []).at(-1)
  const retry = last?.retry
  if (!last || !retry) return null
  return (
    <TurnRetrying
      kind={retry.error.type}
      text={retry.error.message}
      provider={providerLabel(last.model.providerID)}
      at={DateTime.toEpochMillis(retry.at)}
      attempt={retry.attempt}
      handlers={props.context.handlers(row.userMessageID)}
    />
  )
}

function Separator(props: { children: ReactNode }) {
  return (
    <Marker variant="separator">
      <MarkerContent>{props.children}</MarkerContent>
    </Marker>
  )
}

function ModelSwitched(props: { message: Extract<SessionMessage.Info, { type: "model-switched" }>; context: Context }) {
  const model = props.message.model
  const variant = model.variant && model.variant !== "default" ? model.variant : undefined
  return (
    <Separator>
      {props.context.modelNames.get(model.id) ?? model.id}
      {variant ? ` · ${variant.charAt(0).toUpperCase()}${variant.slice(1)}` : null}
    </Separator>
  )
}

function NoticeRow(props: { messageID: string; context: Context }) {
  const message = props.context.byId.get(props.messageID)
  if (!message) return null
  if (message.type === "compaction") return <Separator>{TimelineText.compaction(message)}</Separator>
  if (message.type === "model-switched") return <ModelSwitched message={message} context={props.context} />
  const notice = TimelineText.notice(message)
  if (!notice) return null
  return (
    <Marker variant="default">
      <MarkerContent>{notice.detail ? `${notice.title} · ${notice.detail}` : notice.title}</MarkerContent>
    </Marker>
  )
}

function SystemRow(props: { row: TimelineRow.Row; context: Context }) {
  const row = props.row
  if (row._tag === "Error") return <ErrorRow row={row} context={props.context} />
  if (row._tag === "Retry") return <RetryRow row={row} context={props.context} />
  if (row._tag === "TurnDivider") return <Separator>Interrupted</Separator>
  if (row._tag === "CompactionQueued") return <Separator>Session compaction queued</Separator>
  if (row._tag !== "Notice") return null
  return <NoticeRow messageID={row.messageID} context={props.context} />
}

function LoadEarlier(props: { onVisible: () => void }) {
  return (
    <div
      aria-hidden
      className="h-px"
      ref={(node) => {
        if (!node) return
        const observer = new IntersectionObserver((entries) => {
          if (node.closest("[data-pending-scroll]")) return
          if (entries.some((entry) => entry.isIntersecting)) props.onVisible()
        })
        observer.observe(node)
        return () => observer.disconnect()
      }}
    />
  )
}

interface Context {
  readonly admin: boolean
  readonly handlers: (userMessageID: string) => ProblemHandlers
  readonly modelNames: ReadonlyMap<string, string>
  readonly byId: ReadonlyMap<string, SessionMessage.Info>
  readonly turns: ReadonlyMap<string, ReadonlyArray<SessionMessage.Assistant>>
  readonly activeMessageID: string | undefined
}

function UserBlock(props: {
  message: SessionMessage.User
  transcript: TranscriptProps
  editing: boolean
  onEditing: (id: string | undefined) => void
}) {
  const transcript = props.transcript
  const message = props.message
  const status = transcript.statuses.get(message.id)
  const pending = status === "starting" || status === "steering" || status === "stranded"
  const senderId = message.sender?.userId
  const person =
    senderId && senderId !== transcript.viewer.id
      ? (transcript.people.get(senderId) ?? { name: "Member", image: undefined })
      : transcript.viewer
  const edit = transcript.onEdit
  return (
    <UserMessage
      message={message}
      spaceId={transcript.spaceId}
      root={transcript.view.root}
      person={person}
      pending={pending}
      editing={props.editing}
      onEdit={edit && !pending ? () => props.onEditing(message.id) : undefined}
      onCancel={() => props.onEditing(undefined)}
      onSave={(text) => {
        props.onEditing(undefined)
        edit?.(message, text)
      }}
    />
  )
}

function SmoothMarkdown(props: {
  text: string
  streaming: boolean
  className: string
  apps?: ReadonlyArray<CatalogApp> | undefined
  root?: Session.ID | undefined
  images?: ReadonlyMap<string, string> | undefined
}) {
  const text = useSmoothText(props.text, { streaming: props.streaming })
  const root = props.root
  const dirs = dirsOf(
    [...text.matchAll(/`([^`\n]+)`/gu)].flatMap((match) => (isPath(match[1] ?? "") ? [match[1] ?? ""] : [])),
  )
  return (
    <Markdown
      streaming={props.streaming || text.length < props.text.length}
      apps={props.apps}
      className={props.className}
      workspaceImage={
        root
          ? (path, alt) => <WorkspaceImage root={root} path={path} alt={alt} src={props.images?.get(path)} />
          : undefined
      }
      workspaceFile={
        root
          ? (code, fallback) =>
              isPath(code) ? <WorkspaceFileChip root={root} input={code} dirs={dirs} fallback={fallback} /> : undefined
          : undefined
      }
    >
      {text}
    </Markdown>
  )
}

function AnswerBlock(props: {
  text: string
  streaming: boolean
  copy: string | undefined
  root: Session.ID
  messages: ReadonlyArray<SessionMessage.Info>
}) {
  const apps = useMentionedApps(props.text)
  const images = new Map(
    props.messages.flatMap((message) =>
      message.type !== "assistant"
        ? []
        : message.content.flatMap((part) => {
            if (part.type !== "tool" || part.state.status !== "completed") return []
            const input = part.state.input
            return part.state.content.flatMap((content) => {
              if (content.type !== "file" || !content.uri.startsWith("data:image/")) return []
              const source = content.name ?? (part.name === "read" ? (input.path ?? input.filePath) : undefined)
              if (typeof source !== "string") return []
              const path = source.replace(/^.*\/(?=\.ren\/images\/)/u, "").replace(/^\.\//u, "")
              return [[path, content.uri] as const]
            })
          }),
    ),
  )
  return (
    <Message>
      <MessageContent>
        <Bubble variant="ghost">
          <BubbleContent data-searchable="" className="text-base leading-[1.7]">
            <SmoothMarkdown
              text={props.text}
              root={props.root}
              images={images}
              streaming={props.streaming}
              apps={apps}
              className="text-base leading-[1.7]"
            />
          </BubbleContent>
        </Bubble>
        {props.copy ? (
          <MessageFooter>
            <CopyButton text={props.copy} />
          </MessageFooter>
        ) : null}
      </MessageContent>
    </Message>
  )
}

function BlockView(props: {
  block: Block
  transcript: TranscriptProps
  context: Context
  editing: string | undefined
  onEditing: (id: string | undefined) => void
  activeTurn: string | undefined
  copyOf: (turn: string, key: string) => string | undefined
  workedFor: (turn: string) => string | undefined
}) {
  const block = props.block
  if (block.kind === "user")
    return (
      <UserBlock
        message={block.message}
        transcript={props.transcript}
        editing={props.editing === block.message.id}
        onEditing={props.onEditing}
      />
    )
  if (block.kind === "steps")
    return (
      <Message>
        <MessageContent>
          <Steps
            expanded={props.transcript.expanded}
            steps={block.steps}
            running={props.activeTurn === block.turn}
            workedFor={props.workedFor(block.turn)}
            view={props.transcript.view}
            onOpenChild={props.transcript.onOpenChild}
          />
        </MessageContent>
      </Message>
    )
  if (block.kind === "answer")
    return (
      <AnswerBlock
        root={props.transcript.view.root}
        messages={props.transcript.messages}
        text={block.text}
        streaming={block.streaming}
        copy={props.copyOf(block.turn, block.key)}
      />
    )
  if (block.kind === "reply") return <ChannelReplyMessage tool={block.tool} />
  if (block.kind === "connect")
    return (
      <Message>
        <MessageContent>
          {block.connects.map((connect) => (
            <AppConnectCard
              key={`${connect.appId}:${connect.spaceId}`}
              appId={connect.appId}
              spaceId={connect.spaceId}
            />
          ))}
        </MessageContent>
      </Message>
    )
  if (block.kind === "file")
    return (
      <Message>
        <MessageContent>
          <DriveFileCards spaceId={props.transcript.spaceId} files={[block.file]} />
        </MessageContent>
      </Message>
    )
  return <SystemRow row={block.row} context={props.context} />
}

function History(props: { loading: boolean; onLoadMore: () => void }) {
  return (
    <div className="absolute inset-x-0 top-0 flex h-6 items-center justify-center text-xs text-muted-foreground">
      {props.loading ? (
        <output className="flex items-center gap-2">
          <Spinner />
          Loading earlier messages
        </output>
      ) : (
        <LoadEarlier onVisible={props.onLoadMore} />
      )}
    </div>
  )
}

function WorkingMarker(props: { busy: boolean; working: boolean }) {
  if (!props.busy && !props.working) return null
  return (
    // ast-grep-ignore: require-message-scroller-parts -- rendered only inside the transcript's MessageScrollerContent
    <MessageScrollerItem messageId="working">
      <Marker
        aria-hidden={!props.working}
        className={cn("transition-opacity duration-150", !props.working && "opacity-0")}
      >
        <MarkerContent className="shimmer motion-reduce:shimmer-none">Working on the next step</MarkerContent>
      </Marker>
    </MessageScrollerItem>
  )
}

const liveItems = 20

function useEasedSend(blocks: ReadonlyArray<Block>) {
  const sent = blocks.filter((block) => block.kind === "user").length
  const [opened, setOpened] = useState(sent)
  if (sent < opened) setOpened(sent)
  return sent > opened && blocks.at(-1)?.kind === "user" ? "" : undefined
}

function useWatchedTurns(running: string | undefined) {
  const [watched, setWatched] = useState<ReadonlySet<string>>(() => new Set())
  if (running && !watched.has(running)) setWatched(new Set([...watched, running]))
  return { live: (turn: string | undefined) => turn !== undefined && (turn === running || watched.has(turn)) }
}

const scrollUpKeys = new Set(["ArrowUp", "PageUp", "Home"])

const bottomSlack = 8

const atBottom = (viewport: HTMLElement) =>
  viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= bottomSlack

function useFollow(turn: string | undefined) {
  const [paused, setPaused] = useState<{ readonly turn: string | undefined }>()
  const following = paused === undefined || paused.turn !== turn
  return {
    following,
    pause: () => {
      if (following) flushSync(() => setPaused({ turn }))
    },
    resume: () => setPaused(undefined),
  }
}

function contextOf(props: TranscriptProps, byId: ReadonlyMap<string, SessionMessage.Info>): Context {
  return {
    admin: props.admin ?? false,
    handlers: (userMessageID) => {
      const user = byId.get(userMessageID)
      const text = user?.type === "user" ? user.text : undefined
      const tryAgain = props.onTryAgain
      return {
        onTryAgain: tryAgain && text ? () => tryAgain(text) : undefined,
        onContinue: props.onContinue,
        onChangeModel: props.onChangeModel,
        onStop: props.onStop,
      }
    },
    modelNames: props.modelNames ?? new Map(),
    byId,
    turns: Projection.assistantMessagesByParent(props.messages),
    activeMessageID: props.activeMessageID,
  }
}

export function Transcript(props: TranscriptProps) {
  const follow = useFollow(props.activeMessageID)
  if (props.loading)
    return (
      <div className="min-h-0 flex-1 overflow-hidden">
        {props.more && !props.loadingHistory ? <LoadEarlier onVisible={props.onLoadMore} /> : null}
        <div className="mx-auto w-full max-w-3xl p-6">
          <MessagesSkeleton />
        </div>
      </div>
    )
  return (
    <MessageScrollerProvider autoScroll={follow.following && props.find === undefined}>
      <TranscriptScroller transcript={props} follow={follow} />
    </MessageScrollerProvider>
  )
}

function FindOverlay(props: { find: FindBarProps; blocks: ReadonlyArray<Block> }) {
  const match = props.find.match
  const row = props.blocks.find(
    (block) =>
      block.key === match?.row || (block.kind === "steps" && block.steps.some((step) => step.key === match?.row)),
  )?.key
  return (
    <div className="absolute top-2 right-4 z-10">
      <FindBar {...props.find} match={row && match ? { row, occurrence: match.occurrence } : undefined} />
    </div>
  )
}

function TranscriptScroller(input: { transcript: TranscriptProps; follow: ReturnType<typeof useFollow> }) {
  const props = input.transcript
  const follow = input.follow
  const scroller = useMessageScroller()
  const touchY = useRef(0)
  const lastTop = useRef(0)
  const pause = (viewport: HTMLElement) => {
    if ((viewport.querySelector<HTMLElement>("[data-message-scroller-spacer]")?.offsetHeight ?? 0) > 0) return
    follow.pause()
  }
  const toEnd = () => {
    flushSync(follow.resume)
    scroller.scrollToEnd()
  }
  const byId: ReadonlyMap<string, SessionMessage.Info> = new Map(props.messages.map((message) => [message.id, message]))
  const context = contextOf(props, byId)
  const turns = context.turns
  const activeTurn = props.busy ? props.activeMessageID : undefined
  const watched = useWatchedTurns(activeTurn)
  const blocks = groupTurns(blocksOf(props.rows, byId), watched.live)
  const easing = useEasedSend(blocks)
  const [editing, setEditing] = useState<string>()
  const lastAnswer = new Map(
    blocks.flatMap((block) => (block.kind === "answer" ? [[block.turn, block.key] as const] : [])),
  )
  const workedFor = (turn: string) => {
    const user = byId.get(turn)
    const milliseconds = TimelineText.turnDuration(user?.type === "user" ? user : undefined, turns.get(turn) ?? [])
    return milliseconds === undefined ? undefined : TimelineText.duration(milliseconds)
  }
  const copyOf = (turn: string, key: string) =>
    lastAnswer.get(turn) === key && activeTurn !== turn ? TimelineText.copyText(turns.get(turn) ?? [])?.text : undefined
  const empty =
    props.empty && blocks.length === 0 && !props.busy && !props.more && !props.loadingHistory && !props.loading
  return (
    <MessageScroller className="@container flex-1">
      <MessageScrollerViewport
        preserveScrollOnPrepend
        pinEnd={follow.following && props.find === undefined}
        data-easing={easing}
        className="relative scrollbar-gutter-both outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--color-border)] data-easing:scroll-smooth motion-reduce:scroll-auto"
        onWheel={(event: WheelEvent<HTMLDivElement>) => {
          if (event.deltaY < 0) pause(event.currentTarget)
          else if (atBottom(event.currentTarget)) toEnd()
        }}
        onTouchStart={(event: TouchEvent<HTMLDivElement>) => {
          touchY.current = event.touches[0]?.clientY ?? 0
        }}
        onTouchMove={(event: TouchEvent<HTMLDivElement>) => {
          if ((event.touches[0]?.clientY ?? 0) > touchY.current) pause(event.currentTarget)
        }}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          if (scrollUpKeys.has(event.key)) pause(event.currentTarget)
        }}
        onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
          const viewport = event.currentTarget
          if (event.clientX > viewport.getBoundingClientRect().left + viewport.clientLeft + viewport.clientWidth)
            pause(event.currentTarget)
        }}
        onScroll={(event: UIEvent<HTMLDivElement>) => {
          const viewport = event.currentTarget
          const down = viewport.scrollTop > lastTop.current
          lastTop.current = viewport.scrollTop
          if (!follow.following && down && atBottom(viewport)) toEnd()
        }}
      >
        {props.more ? <History loading={props.loadingHistory} onLoadMore={props.onLoadMore} /> : null}
        <MessageScrollerContent className="relative mx-auto w-full max-w-3xl p-6">
          {blocks.map((block, index) => (
            <MessageScrollerItem
              key={block.key}
              messageId={block.key}
              data-row-key={block.key}
              scrollAnchor={block.kind === "user"}
              className={cn(
                block.kind === "user" && "@transcript:-mr-13.5 @transcript:pr-13.5",
                index >= blocks.length - liveItems && "[content-visibility:visible]",
              )}
            >
              <BlockView
                block={block}
                transcript={props}
                context={context}
                editing={editing}
                onEditing={setEditing}
                activeTurn={activeTurn}
                copyOf={copyOf}
                workedFor={workedFor}
              />
            </MessageScrollerItem>
          ))}
          {empty ? (
            <MessageScrollerItem messageId="empty">
              <EmptyState>{props.empty}</EmptyState>
            </MessageScrollerItem>
          ) : null}
          <WorkingMarker busy={props.busy || watched.live(props.activeMessageID)} working={props.working} />
        </MessageScrollerContent>
      </MessageScrollerViewport>
      {props.find ? <FindOverlay find={props.find} blocks={blocks} /> : null}
      <MessageScrollerButton />
    </MessageScroller>
  )
}
