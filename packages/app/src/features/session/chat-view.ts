import { useAtomValue } from "@effect/atom-react"
import { ChatState, Family, ToolState, Working, type ChatAtoms, type TimelineDetail, type TimelineRow } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import { SessionModel } from "@ren/schema/session/model"
import { DateTime, Predicate } from "effect"
import { AsyncResult } from "effect/reactivity"
import { sessionTitle } from "../../lib/sessions.js"

const noRows: ReadonlyArray<TimelineRow.Row> = []

const noActivity: ReadonlyArray<Family.Activity> = []

export const childTitle = (state: ChatState.State, sessionID: string) =>
  sessionTitle(Family.childTitle(state, sessionID, ""), "Subagent")

const workingRoot = (
  state: ChatState.State,
  view: { readonly root: Session.ID; readonly child: Session.ID | undefined },
) => (view.child ? (state.info[view.child]?.parentID ?? view.root) : view.root)

export interface ContextUsage {
  readonly tokens: number
  readonly input: number
  readonly output: number
  readonly reasoning: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly model: SessionModel.Ref
  readonly limit?: number
  readonly percent?: number
}

const contextUsageOf = (
  state: ChatState.State,
  sessionID: string,
  models: AsyncResult.AsyncResult<ReadonlyArray<SessionModel.Info>, unknown>,
): ContextUsage | undefined => {
  const step = ChatState.contextStep(state, sessionID)
  if (!step) return undefined
  const tokens = ChatState.contextTokens(step.tokens)
  const limit = AsyncResult.getOrElse(models, () => []).find(
    (each) => SessionModel.key(each) === SessionModel.key(step.model),
  )?.limit.context
  return {
    tokens,
    input: step.tokens.input,
    output: step.tokens.output,
    reasoning: step.tokens.reasoning,
    cacheRead: step.tokens.cache.read,
    cacheWrite: step.tokens.cache.write,
    model: step.model,
    ...(limit && limit > 0 && { limit, percent: Math.min(100, Math.round((tokens / limit) * 100)) }),
  }
}

// oxlint-disable-next-line ren/no-comments -- A chat shows once it has its history: read, cached or saved, or a message of ours on its way. Rows that only events brought, such as a notice, would show alone and then get pushed down by the history above them.
const showable = (state: ChatState.State, sessionID: string) => {
  const messages = state.messages[sessionID]
  if (messages === undefined) return false
  return (
    state.loaded.has(sessionID) ||
    state.partial.has(sessionID) ||
    messages.some((message) => state.outbox.has(message.id))
  )
}

export function useView(root: Session.ID, child: Session.ID | undefined, detail: TimelineDetail.Detail) {
  const session = ChatReact.useSession(root, { child, detail })
  const state = AsyncResult.getOrElse(session.state, () => ChatState.empty)
  const viewed = child ?? root
  const projection = AsyncResult.getOrElse(session.timeline, () => undefined)
  const models = ChatReact.useModels(root)
  const permission = Family.permission(state, viewed)
  const form = Family.form(state, viewed)
  return {
    session,
    state,
    viewed,
    projection,
    loading: !AsyncResult.isFailure(session.state) && !showable(state, viewed),
    messages: ChatState.messages(state, viewed),
    contextUsage: contextUsageOf(state, viewed, models),
    rows: projection?.rows ?? noRows,
    running: ChatState.activity(state, viewed) === "running",
    activity: child ? noActivity : Family.activity(state, root),
    working: projection ? Working.show(state, viewed, projection, workingRoot(state, { root, child })) : false,
    permission,
    permissionTitle: permission ? childTitle(state, permission.sessionID) : "",
    form,
    formTitle: form ? childTitle(state, form.sessionID) : "",
    formExpired: form ? Family.isExpired(state, form) : false,
  }
}

export function useSubagentCard(view: ChatAtoms.View, tool: SessionMessage.Tool) {
  const state = AsyncResult.getOrElse(useAtomValue(ChatReact.useAtoms().state(view.root)), () => ChatState.empty)
  return Family.subagent(state, view.sessionID, tool)
}

export interface SubagentRun {
  readonly key: string
  readonly tool: string
  readonly child: Session.ID | undefined
  readonly description: string
  readonly agent: string
  readonly status: Family.SubagentStatus
  readonly running: boolean
  readonly needsInput: boolean
  readonly activity: string | undefined
  readonly started: number
  readonly ended: number | undefined
}

export interface ShellRun {
  readonly key: string
  readonly tool: string | undefined
  readonly id: string
  readonly sessionID: string
  readonly command: string
  readonly running: boolean
  readonly started: number
  readonly ended: number | undefined
  readonly exit: number | undefined
  readonly state: string | undefined
  readonly timeout: boolean
}

const text = (value: unknown) => (Predicate.isString(value) ? value : undefined)

const millis = (time: DateTime.Utc) => DateTime.toEpochMillis(time)

const ran = (tool: SessionMessage.Tool) => tool.time.ran ?? tool.time.created

// oxlint-disable-next-line ren/no-comments -- The name of a subagent's agent, shown only for a custom agent. The default agent, general, goes unnamed, and so does a subagent without an agent, which Family.subagent titles "Subagent".
export const customAgent = (agent: string | undefined) =>
  agent && !["general", "subagent"].includes(agent.toLowerCase())
    ? `${agent.slice(0, 1).toUpperCase()}${agent.slice(1)}`
    : undefined

export const isShellNotice = (message: SessionMessage.Info): message is SessionMessage.Synthetic =>
  message.type === "synthetic" && message.metadata?.source === "shell"

interface Report {
  readonly time: DateTime.Utc
  readonly failed: boolean
}

// oxlint-disable-next-line ren/no-comments -- A subagent in the background ends its tool call at once. It runs until it reports back, even while its own session is not loaded.
const progressOf = (input: {
  readonly card: Family.Subagent
  readonly info: ChatState.State["info"][string] | undefined
  readonly report: Report | undefined
  readonly completed: DateTime.Utc | undefined
}) => {
  const card = input.card
  const info = input.info
  const running =
    card.status === "running" || card.status === "delegating" || (card.background && input.report === undefined)
  const ended = input.report?.time ?? (info ? (info.time.idle ?? info.time.updated) : input.completed)
  return { running, ended: running || !ended ? undefined : millis(ended) }
}

const runningFirst = <A extends { readonly running: boolean; readonly started: number }>(runs: ReadonlyArray<A>) => [
  ...runs.filter((run) => run.running),
  ...runs.filter((run) => !run.running).toSorted((a, b) => b.started - a.started),
]

// oxlint-disable-next-line ren/no-comments -- Every subagent the chat started, and the shells it left running in the background: the ones still running first, then the finished ones, latest first. A shell that holds up the current turn is a step of that turn, not background work.
export function useWork(root: Session.ID) {
  const state = AsyncResult.getOrElse(useAtomValue(ChatReact.useAtoms().state(root)), () => ChatState.empty)
  const messages = ChatState.messages(state, root)
  const tools = messages.flatMap((message) =>
    message.type === "assistant"
      ? message.content.filter((content): content is SessionMessage.Tool => content.type === "tool")
      : [],
  )
  const reports = new Map<string | undefined, Report>(
    messages.flatMap((message) =>
      message.type === "synthetic" && message.metadata?.source === "subagent" && message.metadata.childID
        ? [
            [
              message.metadata.childID,
              { time: message.time.created, failed: message.metadata.state === "error" },
            ] as const,
          ]
        : [],
    ),
  )
  const subagents = tools
    .filter((tool) => tool.name === "subagent" || tool.name === "task")
    .map((tool): SubagentRun => {
      const card = Family.subagent(state, root, tool)
      const child = card.child ? Session.ID.make(card.child) : undefined
      const info = child ? state.info[child] : undefined
      const report = reports.get(card.child)
      const progress = progressOf({ card, info, report, completed: tool.time.completed })
      return {
        key: tool.id,
        tool: tool.id,
        child,
        description: card.description ?? card.title,
        agent: card.title,
        status: report?.failed ? "failed" : card.status,
        running: progress.running,
        needsInput: card.needsInput,
        activity: card.activity,
        started: millis(info?.time.created ?? ran(tool)),
        ended: progress.ended,
      }
    })
  const backgrounded = tools.filter(
    (tool) =>
      tool.name === "shell" && tool.state.status === "completed" && ToolState.metadata(tool).status === "running",
  )
  const shellOf = (tool: SessionMessage.Tool) => text(ToolState.metadata(tool).shellID) ?? tool.id
  const shellTools = new Map(backgrounded.map((tool) => [shellOf(tool), tool.id]))
  const live = Family.activity(state, root).flatMap((item): ReadonlyArray<ShellRun> =>
    item.type === "shell" && !item.blocking && item.id
      ? [
          {
            key: item.key,
            tool: shellTools.get(item.id),
            id: item.id,
            sessionID: item.sessionID ?? root,
            command: item.label,
            running: true,
            started: item.started,
            ended: undefined,
            exit: undefined,
            state: undefined,
            timeout: false,
          },
        ]
      : [],
  )
  const exits = new Map(
    messages.flatMap((message) =>
      message.type === "synthetic" && message.metadata?.source === "shell"
        ? [message.metadata.shellID, message.metadata.jobID].filter(Predicate.isString).map(
            (id) =>
              [
                id,
                {
                  at: millis(message.time.created),
                  exit: message.metadata?.exit,
                  state: message.metadata?.state,
                  timeout: message.metadata?.timeout === true,
                },
              ] as const,
          )
        : [],
    ),
  )
  const finished = backgrounded.flatMap((tool): ReadonlyArray<ShellRun> => {
    const id = shellOf(tool)
    const end = exits.get(id) ?? exits.get(tool.id)
    if (!end || live.some((run) => run.id === id)) return []
    return [
      {
        key: tool.id,
        tool: tool.id,
        id,
        sessionID: root,
        command: text(ToolState.input(tool).command) ?? id,
        running: false,
        started: millis(ran(tool)),
        ended: end.at,
        exit: end.exit,
        state: end.state,
        timeout: end.timeout,
      },
    ]
  })
  return { subagents: runningFirst(subagents), shells: runningFirst([...live, ...finished]) }
}

export function useRunningAgent(root: Session.ID) {
  const state = AsyncResult.getOrElse(useAtomValue(ChatReact.useAtoms().state(root)), () => ChatState.empty)
  return ChatState.messages(state, root).findLast((message) => message.type === "assistant")?.agent
}

export function notificationsOf(state: ChatState.State, root: Session.ID) {
  const family = Family.tree(state, root)
  const last = ChatState.messages(state, root).at(-1)
  const failed = last?.type === "idle" ? last.outcome === "failed" : false
  const interrupted = last?.type === "idle" ? last.outcome === "interrupted" : false
  const permissions = family.flatMap((sessionID) =>
    (state.permissions[sessionID] ?? []).map((request) => ({
      kind: "permissions" as const,
      id: request.id,
      sessionID,
    })),
  )
  const questions = family.flatMap((sessionID) =>
    (state.forms[sessionID] ?? [])
      .filter((form) => form.kind === "question" || form.kind === "websearch.provider")
      .map((form) => ({ kind: "questions" as const, id: form.id, sessionID })),
  )
  return {
    delegated: family.some((id) => id !== root && ChatState.activity(state, id) === "running"),
    outcome: last?.type === "idle" && !interrupted ? { id: last.id, failed } : undefined,
    requests: [...permissions, ...questions],
  }
}
