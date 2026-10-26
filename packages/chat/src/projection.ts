export * as Projection from "./projection.js"

import type { SessionMessage } from "@ren/schema/session/message"
import type { SessionModel } from "@ren/schema/session/model"
import { Exit, Option, Predicate, Schema } from "effect"
import { TimelineDetail } from "./timeline-detail.js"
import { TimelineRow } from "./timeline-row.js"
import { ChannelReply } from "./channel-reply.js"
import { ToolState } from "./tool-state.js"

export type ReasoningMode = "hidden" | "compact" | "full"

type Notice = Exclude<
  SessionMessage.Info,
  SessionMessage.User | SessionMessage.Assistant | SessionMessage.Shell | SessionMessage.Idle
>

type FailedIdle = SessionMessage.Idle & {
  readonly outcome: "failed"
  readonly error: NonNullable<SessionMessage.Idle["error"]>
}

type Entry =
  | { readonly type: "assistant"; readonly message: SessionMessage.Assistant }
  | { readonly type: "notice"; readonly message: Notice }
  | { readonly type: "idle"; readonly message: FailedIdle }

interface Turn {
  readonly id: string
  readonly user?: SessionMessage.User
  readonly shell?: SessionMessage.Shell
  readonly entries: Array<Entry>
}

interface Ref {
  readonly messageID: string
  readonly messageIndex: number
  readonly partID: string
  readonly content: SessionMessage.Content
}

export interface Input {
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly busy: boolean
  readonly reasoning?: ReasoningMode
  readonly shellToolDefaultOpen?: boolean
  readonly editToolDefaultOpen?: boolean
  readonly detail?: TimelineDetail.Detail
  readonly pendingInputIDs?: ReadonlySet<string>
  readonly queuedCompactionIDs?: ReadonlyArray<string>
  readonly previous?: ReadonlyArray<TimelineRow.Row>
}

export interface Projection {
  readonly activeMessageID: string | undefined
  readonly rows: ReadonlyArray<TimelineRow.Row>
}

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))
const decodeString = Schema.decodeUnknownOption(Schema.String)
const lenient = <S extends Schema.Top>(schema: S) =>
  Schema.optionalKey(schema.pipe(Schema.catchDecoding(() => Exit.succeed(Option.none()))))
const decodeErrorEnvelope = Schema.decodeUnknownOption(
  Schema.Struct({ error: Schema.optionalKey(Schema.Unknown), message: lenient(Schema.String) }),
)
const decodeErrorDetails = Schema.decodeUnknownOption(
  Schema.Struct({ type: lenient(Schema.String), message: lenient(Schema.String), code: lenient(Schema.String) }),
)

export const isInterrupted = (error: SessionMessage.Assistant["error"]) =>
  Boolean(error?.type.toLowerCase().includes("abort") || error?.type.toLowerCase().includes("interrupt"))

const isFailedIdle = (message: SessionMessage.Info): message is FailedIdle =>
  message.type === "idle" && message.outcome === "failed" && Boolean(message.error)

const shellFailed = (message: SessionMessage.Shell) =>
  message.status === "timeout" || (message.status === "exited" && Boolean(message.exit))

const isNotice = (message: SessionMessage.Info): message is Notice => {
  if (message.type === "user" || message.type === "assistant" || message.type === "shell" || message.type === "idle")
    return false
  if (message.type !== "synthetic") return true
  return Boolean(message.description?.trim()) || TimelineDetail.noticeRequired(message)
}

export const contentEntries = (message: SessionMessage.Assistant) => {
  const ordinals = { text: 0, reasoning: 0 }
  return message.content.map((content) => ({
    id: content.type === "tool" ? content.id : `${message.id}:${content.type}:${ordinals[content.type]++}`,
    content,
  }))
}

export const resolveContent = (message: SessionMessage.Info | undefined, partID: string) => {
  const ordinals = { text: 0, reasoning: 0 }
  return message?.type === "assistant"
    ? message.content.find(
        (content) =>
          (content.type === "tool" ? content.id : `${message.id}:${content.type}:${ordinals[content.type]++}`) ===
          partID,
      )
    : undefined
}

const toolRenderable = (content: SessionMessage.Tool, detail?: TimelineDetail.Detail) => {
  if (detail && ToolState.failed(content)) return true
  if (content.name === "todowrite") return false
  if (content.name === "question") return content.state.status !== "streaming" && content.state.status !== "running"
  const category = TimelineDetail.category(content)
  return !(detail && category && detail[category].placement === "hidden")
}

interface View {
  readonly showReasoning: boolean
  readonly expanded: ToolState.Expanded
  readonly detail: TimelineDetail.Detail | undefined
}

export const renderable = (content: SessionMessage.Content, view: Pick<View, "showReasoning" | "detail">) => {
  if (content.type === "text") return Boolean(content.text.trim())
  if (content.type === "reasoning")
    return (
      (view.detail ? view.detail.thinking.placement !== "hidden" : view.showReasoning) && Boolean(content.text.trim())
    )
  return toolRenderable(content, view.detail)
}

type GroupType = "context" | "file" | "read"

const isEditTool = (content: SessionMessage.Tool) =>
  content.name === "patch" || content.name === "edit" || content.name === "write"

const detailToolGroupType = (content: SessionMessage.Tool, detail: TimelineDetail.Detail): GroupType | undefined => {
  if (ChannelReply.shown(content)) return
  if (content.name === "question" && !ToolState.failed(content)) return
  const category = TimelineDetail.category(content)
  if (category && detail[category].placement === "grouped") return "context"
  if (ToolState.groupedRead(content)) return "read"
  return !ToolState.failed(content) && isEditTool(content) ? "file" : undefined
}

const unsettledShell = (content: SessionMessage.Tool) =>
  (content.name === "shell" || content.name === "execute" || content.name === "subagent") &&
  (content.state.status !== "completed" || ToolState.metadata(content).status === "running")

const expandedError = (content: SessionMessage.Tool, expanded: ToolState.Expanded) =>
  ((content.name === "shell" || content.name === "execute") && expanded.shell) || (isEditTool(content) && expanded.edit)

const defaultToolGroupType = (
  content: SessionMessage.Tool,
  expanded: ToolState.Expanded,
  group: { readonly hasContextGroup: boolean },
): GroupType | undefined => {
  if (content.name === "question" || ToolState.hasLoadedFiles(content)) return
  if (ChannelReply.shown(content)) return
  if (content.state.status === "error") return expandedError(content, expanded) ? undefined : "context"
  if (!group.hasContextGroup && unsettledShell(content)) return
  if (ToolState.defaultOpen(content, expanded) !== true) return "context"
  return isEditTool(content) ? "file" : undefined
}

const contentGroupType = (
  content: SessionMessage.Content,
  view: View,
  group: { readonly hasContextGroup: boolean },
): GroupType | undefined => {
  if (content.type === "tool")
    return view.detail ? detailToolGroupType(content, view.detail) : defaultToolGroupType(content, view.expanded, group)
  if (content.type !== "reasoning") return
  return view.detail && view.detail.thinking.placement !== "grouped" ? undefined : "context"
}

const groupContent = (items: ReadonlyArray<Ref>, view: View): ReadonlyArray<TimelineRow.PartGroup> => {
  const detail = view.detail
  const grouped = items.reduce<{
    readonly groups: ReadonlyArray<TimelineRow.PartGroup>
    readonly open?: OpenGroup
  }>(
    (state, item) => {
      const type = contentGroupType(item.content, view, {
        hasContextGroup: state.open?.type === "context" && state.open.tools,
      })
      const ref = { messageID: item.messageID, partID: item.partID }
      if (type) {
        const flushed = state.open?.type === type ? state.groups : [...state.groups, ...close(state.open, detail)]
        const open = state.open?.type === type ? state.open : { type, refs: [], tools: false }
        return {
          groups: flushed,
          open: { type, refs: [...open.refs, ref], tools: open.tools || item.content.type === "tool" },
        }
      }
      return {
        groups: [
          ...state.groups,
          ...close(state.open, detail),
          { type: "part", key: `part:${item.messageID}:${item.partID}`, ref },
        ],
      }
    },
    { groups: [] },
  )
  return [...grouped.groups, ...close(grouped.open, detail)]
}

interface OpenGroup {
  readonly type: GroupType
  readonly refs: ReadonlyArray<TimelineRow.PartRef>
  readonly tools: boolean
}

const close = (open: OpenGroup | undefined, detail?: TimelineDetail.Detail): ReadonlyArray<TimelineRow.PartGroup> => {
  const first = open?.refs.at(0)
  if (!open || !first) return []
  if (!open.tools && !detail)
    return open.refs.map((ref) => ({ type: "part" as const, key: `part:${ref.messageID}:${ref.partID}`, ref }))
  return [
    {
      type: open.type,
      key:
        open.type === "context"
          ? `context:${first.messageID}:${first.partID}`
          : `part:${first.messageID}:${first.partID}`,
      refs: open.refs,
    },
  ]
}

const readJson = (value: string) =>
  decodeJson(value).pipe(
    Option.flatMap((first) =>
      Option.match(decodeString(first), {
        onNone: () => Option.some(first),
        onSome: (inner) => decodeJson(inner.trim()),
      }),
    ),
  )

const errorDetailsText = (value: unknown) =>
  Option.getOrUndefined(
    Option.map(decodeErrorDetails(value), (error) =>
      error.type && error.message ? `${error.type}: ${error.message}` : error.message || error.type || error.code,
    ),
  )

export const unwrapErrorMessage = (message: string) => {
  const text = message.replace(/^Error:\s*/, "").trim()
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  return readJson(text).pipe(
    Option.orElse(() => (start !== -1 && end > start ? readJson(text.slice(start, end + 1)) : Option.none())),
    Option.flatMap(decodeErrorEnvelope),
    Option.match({
      onNone: () => message,
      onSome: (envelope) =>
        errorDetailsText(envelope.error) ||
        envelope.message ||
        Option.getOrUndefined(decodeString(envelope.error)) ||
        message,
    }),
  )
}

const isWorking = (lastStep: Entry | undefined, session: { readonly active: boolean }) =>
  session.active &&
  lastStep?.type === "assistant" &&
  !lastStep.message.time.completed &&
  !lastStep.message.error &&
  !lastStep.message.retry

const isThinking = (lastContent: SessionMessage.Content | undefined, view: View, turn: { readonly working: boolean }) =>
  turn.working &&
  (view.detail ? view.detail.thinking.placement === "separate" : view.showReasoning) &&
  lastContent?.type === "reasoning" &&
  !lastContent.time?.completed

const messageRows = (
  turn: Turn,
  view: View,
  position: { readonly index: number; readonly isActive: boolean; readonly busy: boolean },
) => {
  const index = position.index
  const isActive = position.isActive
  const detail = view.detail
  const rows: Array<TimelineRow.Row> = []
  const turnID = turn.id
  const assistants = turn.entries.flatMap((entry) => (entry.type === "assistant" ? [entry.message] : []))
  const lastAssistant = assistants.at(-1)
  const lastStep = turn.entries.findLast((entry) => entry.type === "assistant" || entry.type === "idle")
  const compaction = turn.entries.some((entry) => entry.type === "notice" && entry.message.type === "compaction")
  const lastContent = lastAssistant?.content.at(-1)
  const working = isWorking(lastStep, { active: isActive && position.busy })
  const thinking = isThinking(lastContent, view, { working })
  const thoughtOnly =
    working &&
    detail?.thinking.placement === "grouped" &&
    assistants.every((message) =>
      message.content.every((content) => content.type === "reasoning" || !renderable(content, view)),
    )
  if (index > 0) rows.push(new TimelineRow.TurnGap({ userMessageID: turnID }))
  if (turn.user) rows.push(new TimelineRow.UserMessage({ userMessageID: turnID }))
  const counter = { groups: 0, previousTool: false }

  const appendGroups = (items: ReadonlyArray<Ref>) => {
    const offsets = { at: 0 }
    for (const group of groupContent(items, view)) {
      const tool = group.type !== "part" || items.at(offsets.at)?.content.type !== "text"
      offsets.at += group.type === "part" ? 1 : group.refs.length
      rows.push(
        new TimelineRow.AssistantPart({
          userMessageID: turnID,
          group,
          previousAssistantPart: counter.groups > 0,
          ...(counter.groups > 0 && { spacing: counter.previousTool && tool ? "tool" : "content" }),
        }),
      )
      counter.groups += 1
      counter.previousTool = tool
    }
  }

  const appendTail = () => {
    const lastEntry = lastAssistant && contentEntries(lastAssistant).at(-1)
    if (thinking && lastAssistant && lastEntry)
      rows.push(
        new TimelineRow.Thinking({ userMessageID: turnID, ref: { messageID: lastAssistant.id, partID: lastEntry.id } }),
      )
    if (lastStep?.type !== "assistant") return
    const error = lastStep.message.error
    if (isActive && lastStep.message.retry) rows.push(new TimelineRow.Retry({ userMessageID: turnID }))
    else if (error && !isInterrupted(error))
      rows.push(
        new TimelineRow.Error({ userMessageID: turnID, kind: error.type, text: unwrapErrorMessage(error.message) }),
      )
  }

  const appendSegment = (messages: ReadonlyArray<SessionMessage.Assistant>) => {
    if (thoughtOnly) return
    const refs = messages.flatMap((message, messageIndex) =>
      contentEntries(message)
        .filter((entry) => renderable(entry.content, view) && !(thinking && entry.content === lastContent))
        .map((entry) => ({ messageID: message.id, messageIndex, partID: entry.id, content: entry.content })),
    )
    const interruptedAt = messages.findIndex((message) => isInterrupted(message.error))
    appendGroups(interruptedAt < 0 ? refs : refs.filter((ref) => ref.messageIndex <= interruptedAt))
    if (interruptedAt >= 0) {
      if (!compaction && detail?.notices.placement !== "hidden")
        rows.push(new TimelineRow.TurnDivider({ userMessageID: turnID }))
      appendGroups(refs.filter((ref) => ref.messageIndex > interruptedAt))
    }
    if (messages.at(-1) === lastAssistant) appendTail()
  }

  const segment = turn.entries.reduce<Array<SessionMessage.Assistant>>((current, entry) => {
    if (entry.type === "assistant") {
      current.push(entry.message)
      return current
    }
    if (entry.type === "idle") {
      appendSegment(current)
      if (entry === lastStep)
        rows.push(
          new TimelineRow.Error({
            userMessageID: turnID,
            kind: entry.message.error.type,
            text: unwrapErrorMessage(entry.message.error.message),
          }),
        )
      return []
    }
    if (detail?.notices.placement === "hidden" && !TimelineDetail.noticeRequired(entry.message)) return current
    appendSegment(current)
    rows.push(new TimelineRow.Notice({ userMessageID: turnID, messageID: entry.message.id }))
    return []
  }, [])
  appendSegment(segment)
  return rows
}

const idleSuppressed = (last: Entry | undefined, lastStep: Entry | undefined) =>
  (last?.type === "notice" &&
    last.message.type === "compaction" &&
    last.message.status === "failed" &&
    !isInterrupted(last.message.error)) ||
  (lastStep?.type === "assistant" && Boolean(lastStep.message.error) && !isInterrupted(lastStep.message.error))

const turnsOf = (messages: ReadonlyArray<SessionMessage.Info>) => {
  const turns: Array<Turn> = []
  const users = new Set<string>()
  const leading: Array<Notice> = []
  const state: { current: Turn | undefined; lastStep: Entry | undefined } = { current: undefined, lastStep: undefined }
  const start = (turn: Turn) => {
    turns.push(turn)
    state.current = turn
    state.lastStep = turn.entries.at(-1)
  }
  const step = (entry: Extract<Entry, { readonly type: "assistant" | "idle" }>) => {
    if (state.current && !state.current.shell) {
      state.current.entries.push(entry)
      state.lastStep = entry
    } else start({ id: entry.message.id, entries: [entry] })
  }
  const add = (message: SessionMessage.Info) => {
    if (isNotice(message)) {
      if (state.current) state.current.entries.push({ type: "notice", message })
      else leading.push(message)
      return
    }
    if (message.type === "shell") return start({ id: message.id, shell: message, entries: [] })
    if (message.type === "user") {
      if (users.has(message.id)) return
      users.add(message.id)
      return start({ id: message.id, user: message, entries: [] })
    }
    if (isFailedIdle(message)) {
      if (idleSuppressed(state.current?.entries.at(-1), state.lastStep)) return
      return step({ type: "idle", message })
    }
    if (message.type === "assistant") step({ type: "assistant", message })
  }
  for (const message of messages) add(message)
  return { turns, leading }
}

const groupedMessageRow = (
  row: TimelineRow.Row,
  previous: TimelineRow.Row | undefined,
  detail: TimelineDetail.Detail,
  separate: ReadonlySet<string>,
) => {
  const grouped =
    ((Predicate.isTagged(row, "Notice") && detail.notices.placement === "grouped") ||
      (Predicate.isTagged(row, "Shell") && detail.shell.placement === "grouped")) &&
    !separate.has(row.messageID)
  return grouped
    ? new TimelineRow.AssistantPart({
        userMessageID: row.userMessageID,
        previousAssistantPart: Predicate.isTagged(previous, "AssistantPart"),
        ...((Predicate.isTagged(previous, "AssistantPart") || Predicate.isTagged(previous, "Error")) && {
          spacing: "tool" as const,
        }),
        group: {
          type: "context",
          key: `message:${row.messageID}`,
          refs: [{ messageID: row.messageID, partID: row.messageID }],
        },
      })
    : row
}

const groupMessages = (
  rows: ReadonlyArray<TimelineRow.Row>,
  detail: TimelineDetail.Detail,
  separate: ReadonlySet<string>,
) =>
  rows.reduce<Array<TimelineRow.Row>>((result, row) => {
    const previous = result.at(-1)
    const current = groupedMessageRow(row, previous, detail, separate)
    if (
      Predicate.isTagged(previous, "AssistantPart") &&
      previous.group.type === "context" &&
      Predicate.isTagged(current, "AssistantPart") &&
      current.group.type === "context" &&
      previous.userMessageID === current.userMessageID
    ) {
      result[result.length - 1] = new TimelineRow.AssistantPart({
        userMessageID: previous.userMessageID,
        previousAssistantPart: previous.previousAssistantPart,
        ...(previous.spacing && { spacing: previous.spacing }),
        group: { ...previous.group, refs: [...previous.group.refs, ...current.group.refs] },
      })
      return result
    }
    result.push(current)
    return result
  }, [])

const groupPartKey = (ref: TimelineRow.PartRef) => `${ref.messageID}:${ref.partID}`

export const reuse = (
  previous: ReadonlyArray<TimelineRow.Row> | undefined,
  rows: ReadonlyArray<TimelineRow.Row>,
): ReadonlyArray<TimelineRow.Row> => {
  if (!previous?.length) return rows
  const byKey = new Map(previous.map((row) => [TimelineRow.key(row), row] as const))
  const groupByPart = new Map(
    previous.flatMap((row, index) =>
      Predicate.isTagged(row, "AssistantPart") && row.group.type !== "part"
        ? row.group.refs.map((ref) => [groupPartKey(ref), { index, row }] as const)
        : [],
    ),
  )
  const reserved = new Map<string, number>()
  for (const [index, row] of rows.entries()) {
    if (!Predicate.isTagged(row, "AssistantPart") || row.group.type === "part") continue
    const key = TimelineRow.key(row)
    if (byKey.has(key) && !reserved.has(key)) reserved.set(key, index)
  }
  const claimed = new Set<string>()
  const stabilize = (row: TimelineRow.Row, index: number): TimelineRow.Row => {
    if (!Predicate.isTagged(row, "AssistantPart") || row.group.type === "part") return row
    const existing = row.group.refs.reduce<
      { readonly index: number; readonly row: TimelineRow.AssistantPart } | undefined
    >((found, ref) => {
      const candidate = groupByPart.get(groupPartKey(ref))
      if (!candidate) return found
      const key = TimelineRow.key(candidate.row)
      if (claimed.has(key)) return found
      if (reserved.has(key) && reserved.get(key) !== index) return found
      return !found || candidate.index < found.index ? candidate : found
    }, undefined)
    if (!existing) return row
    claimed.add(TimelineRow.key(existing.row))
    if (row.group.key === existing.row.group.key) return row
    return new TimelineRow.AssistantPart({
      userMessageID: row.userMessageID,
      previousAssistantPart: row.previousAssistantPart,
      ...(row.spacing && { spacing: row.spacing }),
      group: { ...row.group, key: existing.row.group.key },
    })
  }
  const next = rows.map((input, index) => {
    const row = stabilize(input, index)
    const existing = byKey.get(TimelineRow.key(row))
    return existing && TimelineRow.equals(existing, row) ? existing : row
  })
  return previous.length === next.length && previous.every((row, index) => row === next[index]) ? previous : next
}

const visibleNotice = (message: Notice, detail: TimelineDetail.Detail | undefined) =>
  detail?.notices.placement !== "hidden" || TimelineDetail.noticeRequired(message)

const shellRows = (
  turn: Turn,
  shell: SessionMessage.Shell,
  index: number,
  detail: TimelineDetail.Detail | undefined,
): ReadonlyArray<TimelineRow.Row> => [
  ...(index > 0 ? [new TimelineRow.TurnGap({ userMessageID: turn.id })] : []),
  ...(detail?.shell.placement !== "hidden" || shellFailed(shell)
    ? [new TimelineRow.Shell({ userMessageID: turn.id, messageID: shell.id })]
    : []),
  ...turn.entries.flatMap((entry) =>
    entry.type === "notice" && visibleNotice(entry.message, detail)
      ? [new TimelineRow.Notice({ userMessageID: turn.id, messageID: entry.message.id })]
      : [],
  ),
]

export const project = (input: Input): Projection => {
  const view: View = {
    showReasoning: (input.reasoning ?? "compact") !== "hidden",
    expanded: { shell: input.shellToolDefaultOpen ?? false, edit: input.editToolDefaultOpen ?? false },
    detail: input.detail,
  }
  const detail = input.detail
  const pendingInputIDs = input.pendingInputIDs
  const built = turnsOf(input.messages)
  const turns = built.turns
  const activeMessageID =
    turns.findLast((turn) => !pendingInputIDs?.has(turn.id) || turn.entries.some((entry) => entry.type === "idle"))
      ?.id ?? turns.at(-1)?.id
  const visibleTurns = detail
    ? turns.filter((turn) => {
        if (turn.user) return true
        if (turn.shell && (detail.shell.placement !== "hidden" || shellFailed(turn.shell))) return true
        return turn.entries.some((entry) =>
          entry.type === "notice"
            ? visibleNotice(entry.message, detail)
            : entry.type === "idle" ||
              Boolean(entry.message.error) ||
              Boolean(entry.message.retry) ||
              entry.message.content.some((content) => renderable(content, view)),
        )
      })
    : turns
  const rows: Array<TimelineRow.Row> = [
    ...built.leading.flatMap((message) =>
      visibleNotice(message, detail)
        ? [new TimelineRow.Notice({ userMessageID: turns.at(0)?.id ?? message.id, messageID: message.id })]
        : [],
    ),
    ...visibleTurns.flatMap((turn, index) => {
      if (turn.shell) return shellRows(turn, turn.shell, index, detail)
      return messageRows(turn, view, { index, isActive: turn.id === activeMessageID, busy: input.busy })
    }),
  ]
  const pendingAt = rows.findIndex(
    (row) =>
      pendingInputIDs?.has(row.userMessageID) ||
      (Predicate.isTagged(row, "Notice") && pendingInputIDs?.has(row.messageID)),
  )
  rows.splice(
    pendingAt < 0 ? rows.length : pendingAt,
    0,
    ...(input.queuedCompactionIDs ?? []).map(
      (inboxID) => new TimelineRow.CompactionQueued({ userMessageID: activeMessageID ?? inboxID, inboxID }),
    ),
  )
  const separate = new Set(
    input.messages.flatMap((message) =>
      message.type === "compaction" || message.type === "model-switched" ? [message.id] : [],
    ),
  )
  return {
    activeMessageID,
    rows: reuse(input.previous, detail ? groupMessages(rows, detail, separate) : rows),
  }
}

export const indexes = (
  rows: ReadonlyArray<TimelineRow.Row>,
): {
  readonly messageRowIndex: ReadonlyMap<string, number>
  readonly messageLastRowIndex: ReadonlyMap<string, number>
  readonly lastAssistantGroupKey: ReadonlyMap<string, string>
} => {
  const messageRowIndex = new Map<string, number>()
  const messageLastRowIndex = new Map<string, number>()
  const lastAssistantGroupKey = new Map<string, string>()
  for (const [index, row] of rows.entries()) {
    if (!messageRowIndex.has(row.userMessageID)) messageRowIndex.set(row.userMessageID, index)
    messageLastRowIndex.set(row.userMessageID, index)
    if (Predicate.isTagged(row, "AssistantPart")) lastAssistantGroupKey.set(row.userMessageID, row.group.key)
  }
  return { messageRowIndex, messageLastRowIndex, lastAssistantGroupKey }
}

export const assistantMessagesByParent = (
  messages: ReadonlyArray<SessionMessage.Info>,
): ReadonlyMap<string, ReadonlyArray<SessionMessage.Assistant>> => {
  const result = new Map<string, Array<SessionMessage.Assistant>>()
  const state: { userID: string | undefined } = { userID: undefined }
  for (const message of messages) {
    if (message.type === "user") state.userID = message.id
    if (message.type === "shell") state.userID = undefined
    if (message.type !== "assistant") continue
    state.userID ??= message.id
    const existing = result.get(state.userID)
    if (existing) existing.push(message)
    else result.set(state.userID, [message])
  }
  return result
}

export const userContext = (
  messages: ReadonlyArray<SessionMessage.Info>,
): ReadonlyMap<string, { readonly agent: string; readonly model: SessionModel.Ref }> => {
  const result = new Map<string, { readonly agent: string; readonly model: SessionModel.Ref }>()
  const state: { agent: string; model: SessionModel.Ref; userID: string | undefined } = {
    agent: "",
    model: { id: "", providerID: "" },
    userID: undefined,
  }
  for (const message of messages) {
    if (message.type === "agent-switched") state.agent = message.agent
    else if (message.type === "model-switched") state.model = message.model
    else if (message.type === "user") {
      state.userID = message.id
      result.set(message.id, { agent: state.agent, model: state.model })
    } else if (message.type === "shell") state.userID = undefined
    else if (message.type === "assistant") {
      state.agent = message.agent
      state.model = message.model
      if (state.userID) result.set(state.userID, { agent: message.agent, model: message.model })
    }
  }
  return result
}

export const reasoningHeading = (text: string): string | undefined => {
  const markdown = text.replaceAll(/\r\n?/g, "\n")
  const html = lastHeading(markdown, /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (value) =>
    value.replaceAll(/<[^>]+>/g, " "),
  )
  const atx = lastHeading(markdown, /^\s{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/gm)
  const setext = lastHeading(markdown, /^([^\n]+)\n(?:=+|-+)\s*$/gm)
  const strong = lastHeading(markdown, /^\s*(?:\*\*((?:(?!\*\*).)+)\*\*|__((?:(?!__).)+)__)\s*$/gm)
  const latest = [html, atx, strong].reduce<{ readonly index: number; readonly value: string } | undefined>(
    (best, current) => (!best || (current && current.index >= best.index) ? current : best),
    undefined,
  )
  return (latest ?? setext)?.value
}

const lastHeading = (markdown: string, pattern: RegExp, transform?: (value: string) => string) =>
  [...markdown.matchAll(pattern)].reduce<{ readonly index: number; readonly value: string } | undefined>(
    (best, match) => {
      const raw = match.at(1) ?? match.at(2) ?? ""
      const value = (transform ? transform(raw) : raw)
        .replaceAll(/`([^`]+)`/g, "$1")
        .replaceAll(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replaceAll(/[*_~]+/g, "")
        .trim()
      return value ? { index: match.index, value } : best
    },
    undefined,
  )
