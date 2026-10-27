import { useState, type ReactNode } from "react"
import { useAtomValue } from "@effect/atom-react"
import { ChatState, Family, Projection, TimelineRow, TimelineText, ToolDisplay, ToolState, type ChatAtoms } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import type { Shell } from "@ren/schema/shell"
import {
  IconAlertTriangle,
  IconBrain,
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconCode,
  IconCopy,
  IconFileText,
  IconGhost,
  IconInfoCircle,
  IconPencil,
  IconRefresh,
  IconSearch,
  IconTool,
  IconWorld,
} from "@tabler/icons-react"
import { AsyncResult } from "effect/reactivity"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import { Message, MessageAvatar, MessageContent, MessageFooter, MessageHeader } from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { Spinner } from "@/components/ui/spinner"
import { Markdown } from "@/components/ren/chat/markdown"
import { cn } from "@/lib/utils"

interface Person {
  readonly name: string
  readonly image: string | undefined
}

export interface TranscriptProps {
  readonly view: ChatAtoms.View
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly rows: ReadonlyArray<TimelineRow.Row>
  readonly activeMessageID: string | undefined
  readonly busy: boolean
  readonly working: boolean
  readonly statuses: ReadonlyMap<string, ChatState.PendingStatus>
  readonly viewer: Person & { readonly id: string }
  readonly people: ReadonlyMap<string, Person>
  readonly more: boolean
  readonly loadingHistory: boolean
  readonly onLoadMore: () => void
  readonly onOpenChild: (sessionID: Session.ID) => void
  readonly onEdit?: ((message: SessionMessage.User) => void) | undefined
  readonly expanded?: boolean | undefined
}

type Step =
  | { readonly kind: "reasoning"; readonly key: string; readonly content: SessionMessage.Reasoning; readonly running: boolean }
  | { readonly kind: "tool"; readonly key: string; readonly tool: SessionMessage.Tool }
  | { readonly kind: "shell"; readonly key: string; readonly message: SessionMessage.Shell }
  | { readonly kind: "notice"; readonly key: string; readonly message: SessionMessage.Info }

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
  | { readonly kind: "row"; readonly key: string; readonly row: TimelineRow.Row }

const streaming = (message: SessionMessage.Info | undefined) => message?.type === "assistant" && !message.time.completed

function stepsOf(row: TimelineRow.Row, byId: ReadonlyMap<string, SessionMessage.Info>): Step[] | undefined {
  if (row._tag === "Thinking") {
    const content = Projection.resolveContent(byId.get(row.ref.messageID), row.ref.partID)
    return content?.type === "reasoning" ? [{ kind: "reasoning", key: TimelineRow.key(row), content, running: true }] : []
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

function blocksOf(rows: ReadonlyArray<TimelineRow.Row>, byId: ReadonlyMap<string, SessionMessage.Info>) {
  return rows.reduce<Block[]>((blocks, row) => {
    if (row._tag === "TurnGap") return blocks
    if (row._tag === "UserMessage") {
      const message = byId.get(row.userMessageID)
      if (message?.type === "user") blocks.push({ kind: "user", key: TimelineRow.key(row), message })
      return blocks
    }
    if (row._tag === "AssistantPart" && row.group.type === "part") {
      const message = byId.get(row.group.ref.messageID)
      const content = Projection.resolveContent(message, row.group.ref.partID)
      if (content?.type === "text") {
        blocks.push({
          kind: "answer",
          key: TimelineRow.key(row),
          turn: row.userMessageID,
          text: content.text,
          streaming: streaming(message),
        })
        return blocks
      }
    }
    const steps = stepsOf(row, byId)
    if (!steps) {
      blocks.push({ kind: "row", key: TimelineRow.key(row), row })
      return blocks
    }
    const last = blocks.at(-1)
    if (last?.kind === "steps" && last.turn === row.userMessageID) last.steps.push(...steps)
    else if (steps.length > 0) blocks.push({ kind: "steps", key: TimelineRow.key(row), turn: row.userMessageID, steps })
    return blocks
  }, [])
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

function UserMessage(props: {
  message: SessionMessage.User
  person: Person
  pending: boolean
  onEdit?: (() => void) | undefined
}) {
  return (
    <Message align="end" className="-mr-13.5 w-auto">
      <MessageAvatar className="ml-3.5">
        <Avatar size="sm">
          {props.person.image ? <AvatarImage src={props.person.image} alt="" /> : null}
          <AvatarFallback className="bg-secondary">{props.person.name.charAt(0)}</AvatarFallback>
        </Avatar>
      </MessageAvatar>
      <MessageContent>
        <MessageHeader className="px-0">{props.person.name}</MessageHeader>
        <Bubble variant="muted" align="end">
          <BubbleContent className="rounded-xl rounded-tr-lg px-4 py-2 text-base leading-[1.6] whitespace-pre-wrap">
            {props.message.text}
          </BubbleContent>
        </Bubble>
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
          <CopyButton text={props.message.text} />
        </MessageFooter>
      </MessageContent>
    </Message>
  )
}

const toolIcons: Record<ToolDisplay.Kind, typeof IconCode> = {
  command: IconCode,
  file: IconFileText,
  edit: IconPencil,
  search: IconSearch,
  web: IconWorld,
  agent: IconGhost,
  tool: IconTool,
}

function Output(props: { text: string; failed?: boolean | undefined }) {
  return (
    <CodeBlock size="sm" variant={props.failed ? "destructive" : "default"} className="mt-1 border-0 bg-muted">
      <CodeBlockContent wrap className="max-h-64 p-3 text-muted-foreground">
        {props.text}
      </CodeBlockContent>
    </CodeBlock>
  )
}

function StepRow(props: { icon: ReactNode; verb: string; subject?: string | undefined; running?: boolean; failed?: boolean; output?: string | undefined }) {
  const trigger = (
    <>
      <MarkerIcon>{props.running ? <Spinner /> : props.icon}</MarkerIcon>
      <MarkerContent className="flex min-w-0 flex-1 items-center gap-2">
        <span className={cn("text-foreground", props.running && "shimmer", props.failed && "text-destructive")}>
          {props.verb}
        </span>
        {props.subject ? (
          <code className="truncate rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs">{props.subject}</code>
        ) : null}
      </MarkerContent>
    </>
  )
  if (!props.output)
    return <Marker className="h-8 rounded-lg px-2">{trigger}</Marker>
  return (
    <Collapsible>
      <CollapsibleTrigger
        render={
          <Marker
            className="h-8 rounded-lg px-2 hover:bg-muted"
            render={<button type="button" aria-label={[props.verb, props.subject].filter(Boolean).join(" ")} />}
          />
        }
      >
        {trigger}
        <IconChevronRight className="transition-transform duration-150 ease-out group-aria-expanded/marker:rotate-90 motion-reduce:transition-none" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Output text={props.output} failed={props.failed} />
      </CollapsibleContent>
    </Collapsible>
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
      icon={<IconCode />}
      verb={ToolDisplay.label(props.tool)}
      subject={ToolDisplay.subtitle(props.tool)}
      running={running}
      failed={failed}
      output={streamed ? TimelineText.shellOutput(streamed) : ToolDisplay.output(props.tool)}
    />
  )
}

function SubagentStep(props: { tool: SessionMessage.Tool; view: ChatAtoms.View; onOpenChild: (id: Session.ID) => void }) {
  const state = AsyncResult.getOrElse(useAtomValue(ChatReact.useAtoms().state(props.view.root)), () => ChatState.empty)
  const card = Family.subagent(state, props.view.sessionID, props.tool)
  const child = card.child
  const running = card.status === "running" || card.status === "delegating"
  const content = (
    <>
      <MarkerIcon>{running ? <Spinner /> : <IconGhost />}</MarkerIcon>
      <MarkerContent className="flex min-w-0 flex-1 items-center gap-2">
        <span className={cn("text-foreground", running && "shimmer", card.status === "failed" && "text-destructive")}>
          {card.needsInput ? "Needs your input" : "Delegated"}
        </span>
        <code className="truncate rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs">{card.title}</code>
      </MarkerContent>
    </>
  )
  if (!child?.startsWith("ses_")) return <Marker className="h-8 rounded-lg px-2">{content}</Marker>
  return (
    <Marker
      className="h-8 rounded-lg px-2 hover:bg-muted"
      render={
        <button type="button" aria-label={`Open ${card.title}`} onClick={() => props.onOpenChild(Session.ID.make(child))} />
      }
    >
      {content}
      <IconChevronRight />
    </Marker>
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
  return (
    <StepRow
      icon={<Icon />}
      verb={ToolDisplay.label(tool)}
      subject={[ToolDisplay.subtitle(tool), ToolDisplay.matches(tool)].filter(Boolean).join(" · ") || undefined}
      running={status === "running"}
      failed={status === "failed"}
      output={error ?? ToolDisplay.output(tool)}
    />
  )
}

function StepItem(props: { step: Step; view: ChatAtoms.View; onOpenChild: (id: Session.ID) => void }) {
  const step = props.step
  if (step.kind === "reasoning")
    return (
      <Marker className="py-1.5">
        {step.running ? (
          <MarkerIcon>
            <IconBrain />
          </MarkerIcon>
        ) : null}
        <MarkerContent className={cn("line-clamp-3 whitespace-pre-wrap", step.running && "shimmer")}>
          {step.content.text.trim() || "Thinking…"}
        </MarkerContent>
      </Marker>
    )
  if (step.kind === "tool") return <ToolStep tool={step.tool} view={props.view} onOpenChild={props.onOpenChild} />
  if (step.kind === "shell") {
    const message = step.message
    const error = TimelineText.shellError(message)
    return (
      <StepRow
        icon={<IconCode />}
        verb={message.status === "running" ? "Running" : "Ran"}
        subject={message.command}
        running={message.status === "running"}
        failed={Boolean(error)}
        output={message.output?.output ? TimelineText.shellOutput(message.output.output) : (error ?? "No output")}
      />
    )
  }
  const notice = TimelineText.notice(step.message)
  if (!notice) return null
  return (
    <Marker className="py-1.5">
      <MarkerIcon>
        <IconInfoCircle />
      </MarkerIcon>
      <MarkerContent>{notice.detail ? `${notice.title} · ${notice.detail}` : notice.title}</MarkerContent>
    </Marker>
  )
}

function Steps(props: {
  expanded?: boolean | undefined
  steps: ReadonlyArray<Step>
  workedFor: string | undefined
  running: boolean
  view: ChatAtoms.View
  onOpenChild: (id: Session.ID) => void
}) {
  const [open, setOpen] = useState(props.expanded === true)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        render={
          <Button
            variant="ghost"
            className="h-7 px-0 text-muted-foreground hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-muted-foreground"
          />
        }
      >
        <IconClock />
        <span className={props.running ? "shimmer" : undefined}>
          {props.running ? "Working, " : props.workedFor ? `Worked for ${props.workedFor}, ` : "Worked, "}
          {props.steps.length === 1 ? "1 step" : `${props.steps.length} steps`}
        </span>
        <IconChevronDown />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 flex flex-col gap-0.5 border-l pl-3">
        {props.steps.map((step) => (
          <StepItem key={step.key} step={step} view={props.view} onOpenChild={props.onOpenChild} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

function SystemRow(props: { row: TimelineRow.Row; context: Context }) {
  const row = props.row
  if (row._tag === "Error") {
    const title = TimelineText.errorTitle(row.kind)
    const parts = TimelineText.errorParts(row.text)
    return (
      <Marker className="items-start text-destructive">
        <MarkerIcon>
          <IconAlertTriangle />
        </MarkerIcon>
        <MarkerContent className="whitespace-pre-wrap">
          {title ?? (parts.head || "Ren hit an error. Send your message again to retry.")}
          {title ? null : parts.body.trim() ? `\n${parts.body.trim()}` : null}
        </MarkerContent>
      </Marker>
    )
  }
  if (row._tag === "Retry") {
    if (props.context.activeMessageID !== row.userMessageID) return null
    const retry = TimelineText.retryStatus(props.context.turns.get(row.userMessageID) ?? [])
    if (!retry) return null
    return (
      <Marker>
        <MarkerIcon>
          <IconRefresh />
        </MarkerIcon>
        <MarkerContent>
          Retrying (attempt {retry.attempt}) · {retry.message}
        </MarkerContent>
      </Marker>
    )
  }
  if (row._tag === "TurnDivider")
    return (
      <Marker variant="separator">
        <MarkerContent>Interrupted</MarkerContent>
      </Marker>
    )
  if (row._tag === "CompactionQueued")
    return (
      <Marker variant="separator">
        <MarkerContent>Session compaction queued</MarkerContent>
      </Marker>
    )
  if (row._tag !== "Notice") return null
  const message = props.context.byId.get(row.messageID)
  if (!message) return null
  if (message.type === "compaction")
    return (
      <Marker variant="separator">
        <MarkerContent>{TimelineText.compaction(message)}</MarkerContent>
      </Marker>
    )
  const notice = TimelineText.notice(message)
  if (!notice) return null
  return (
    <Marker variant={message.type === "model-switched" ? "separator" : "default"}>
      <MarkerContent>{notice.detail ? `${notice.title} · ${notice.detail}` : notice.title}</MarkerContent>
    </Marker>
  )
}

function LoadEarlier(props: { onVisible: () => void }) {
  return (
    <div
      aria-hidden
      className="h-px"
      ref={(node) => {
        if (!node) return
        const observer = new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) props.onVisible()
        })
        observer.observe(node)
        return () => observer.disconnect()
      }}
    />
  )
}

interface Context {
  readonly byId: ReadonlyMap<string, SessionMessage.Info>
  readonly turns: ReadonlyMap<string, ReadonlyArray<SessionMessage.Assistant>>
  readonly activeMessageID: string | undefined
}

export function Transcript(props: TranscriptProps) {
  const byId: ReadonlyMap<string, SessionMessage.Info> = new Map(props.messages.map((message) => [message.id, message]))
  const turns = Projection.assistantMessagesByParent(props.messages)
  const context: Context = { byId, turns, activeMessageID: props.activeMessageID }
  const blocks = blocksOf(props.rows, byId)
  const lastAnswer = new Map(blocks.flatMap((block) => (block.kind === "answer" ? [[block.turn, block.key] as const] : [])))
  const activeTurn = props.busy ? props.activeMessageID : undefined
  const workedFor = (turn: string) => {
    const user = byId.get(turn)
    const milliseconds = TimelineText.turnDuration(user?.type === "user" ? user : undefined, turns.get(turn) ?? [])
    return milliseconds === undefined ? undefined : TimelineText.duration(milliseconds)
  }
  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller className="flex-1">
        <MessageScrollerViewport preserveScrollOnPrepend className="scrollbar-gutter-both!">
          <MessageScrollerContent className="relative mx-auto w-full max-w-3xl p-6">
            {props.more ? (
              <MessageScrollerItem messageId="history" className="absolute inset-x-6 top-1">
                {props.loadingHistory ? (
                  <Marker variant="separator">
                    <MarkerIcon>
                      <Spinner />
                    </MarkerIcon>
                  </Marker>
                ) : (
                  <LoadEarlier onVisible={props.onLoadMore} />
                )}
              </MessageScrollerItem>
            ) : null}
            {blocks.map((block) => {
              if (block.kind === "user") {
                const message = block.message
                const status = props.statuses.get(message.id)
                const pending = status === "starting" || status === "steering" || status === "stranded"
                const senderId = message.sender?.userId
                const person =
                  senderId && senderId !== props.viewer.id
                    ? (props.people.get(senderId) ?? { name: "Member", image: undefined })
                    : props.viewer
                const edit = props.onEdit
                return (
                  <MessageScrollerItem
                    key={block.key}
                    messageId={block.key}
                    scrollAnchor
                    className="-mr-13.5 pr-13.5"
                  >
                    <UserMessage
                      message={message}
                      person={person}
                      pending={pending}
                      onEdit={edit && !pending ? () => edit(message) : undefined}
                    />
                  </MessageScrollerItem>
                )
              }
              if (block.kind === "steps")
                return (
                  <MessageScrollerItem key={block.key} messageId={block.key}>
                    <Message>
                      <MessageContent>
                        <Steps
                          expanded={props.expanded}
                          steps={block.steps}
                          running={activeTurn === block.turn}
                          workedFor={workedFor(block.turn)}
                          view={props.view}
                          onOpenChild={props.onOpenChild}
                        />
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                )
              if (block.kind === "answer") {
                const copy =
                  lastAnswer.get(block.turn) === block.key && activeTurn !== block.turn
                    ? TimelineText.copyText(turns.get(block.turn) ?? [])?.text
                    : undefined
                return (
                  <MessageScrollerItem key={block.key} messageId={block.key}>
                    <Message>
                      <MessageContent>
                        <Bubble variant="ghost">
                          <BubbleContent className="text-base leading-[1.7]">
                            <Markdown streaming={block.streaming} className="text-base leading-[1.7]">
                              {block.text}
                            </Markdown>
                          </BubbleContent>
                        </Bubble>
                        {copy ? (
                          <MessageFooter>
                            <CopyButton text={copy} />
                          </MessageFooter>
                        ) : null}
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                )
              }
              return (
                <MessageScrollerItem key={block.key} messageId={block.key}>
                  <SystemRow row={block.row} context={context} />
                </MessageScrollerItem>
              )
            })}
            {props.working ? (
              <MessageScrollerItem messageId="working">
                <Marker>
                  <MarkerContent>Working on the next step</MarkerContent>
                </Marker>
              </MessageScrollerItem>
            ) : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
