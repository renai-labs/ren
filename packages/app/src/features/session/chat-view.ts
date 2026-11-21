import { useAtomValue } from "@effect/atom-react"
import { ChatState, Family, ToolState } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import { DateTime, Predicate } from "effect"
import { AsyncResult } from "effect/reactivity"

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
