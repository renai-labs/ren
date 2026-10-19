export * as Family from "./family.js"

import type { Form } from "@ren/schema/form"
import type { Permission } from "@ren/schema/permission"
import type { SessionInfo } from "@ren/schema/session-info"
import type { SessionMessage } from "@ren/schema/session-message"
import { DateTime, Predicate } from "effect"
import { ChatState } from "./chat-state.js"
import { ToolDisplay } from "./tool-display.js"
import { ToolState } from "./tool-state.js"

export interface Task {
  readonly id: string
  readonly type: "subagent" | "shell"
  readonly label: string
  readonly agent?: string
}

export interface Blocking {
  readonly type: "subagent" | "shell"
  readonly partID: string
  readonly id: string | undefined
  readonly label: string | undefined
}

export interface Background {
  readonly blocking: ReadonlyArray<Blocking>
  readonly tasks: ReadonlyArray<Task>
}

const string = (value: unknown) => (Predicate.isString(value) ? value : undefined)

export const tree = (state: ChatState.State, sessionID: string): ReadonlyArray<string> => {
  const children = Object.values(state.info).reduce((map, info) => {
    if (info.parentID) map.set(info.parentID, [...(map.get(info.parentID) ?? []), info.id])
    return map
  }, new Map<string, ReadonlyArray<string>>())
  const walk = (ids: ReadonlyArray<string>, at: number): ReadonlyArray<string> => {
    const id = ids[at]
    if (!id) return ids
    return walk([...ids, ...(children.get(id) ?? []).filter((child) => !ids.includes(child))], at + 1)
  }
  return walk([sessionID], 0)
}

const first = <T>(
  state: ChatState.State,
  record: Readonly<Record<string, ReadonlyArray<T>>>,
  sessionID: string,
  include: (item: T) => boolean,
) =>
  tree(state, sessionID)
    .flatMap((id) => record[id] ?? [])
    .find(include)

export const permission = (
  state: ChatState.State,
  sessionID: string,
  include: (request: Permission.Request) => boolean = () => true,
) => first(state, state.permissions, sessionID, include)

export const form = (state: ChatState.State, sessionID: string): Form.Info | undefined =>
  first(state, state.forms, sessionID, (item) => item.kind === "question" || item.kind === "websearch.provider")

export const webSearch = (state: ChatState.State, sessionID: string) => {
  const found = form(state, sessionID)
  return found?.kind === "websearch.provider" ? found : undefined
}

export const question = (state: ChatState.State, sessionID: string) => {
  const found = form(state, sessionID)
  return found?.kind === "question" ? found : undefined
}

export const ancestors = (state: ChatState.State, sessionID: string): ReadonlyArray<string> => {
  const walk = (id: string | undefined, seen: ReadonlySet<string>): ReadonlyArray<string> =>
    id && !seen.has(id) ? [...walk(state.info[id]?.parentID, new Set([...seen, id])), id] : []
  return walk(state.info[sessionID]?.parentID, new Set([sessionID]))
}

export const childTitle = (state: ChatState.State, sessionID: string, fallback: string) => {
  const info = state.info[sessionID]
  if (!info?.parentID) return info?.title ?? ""
  const description = ChatState.messages(state, info.parentID)
    .flatMap((message) => (message.type === "assistant" ? message.content : []))
    .filter(
      (part): part is SessionMessage.Tool =>
        part.type === "tool" &&
        (part.name === "task" || part.name === "subagent") &&
        (part.state.status === "running" || part.state.status === "completed") &&
        (ToolState.metadata(part).sessionId === sessionID || ToolState.metadata(part).sessionID === sessionID),
    )
    .map((tool) => string(ToolState.input(tool).description))
    .findLast((value): value is string => Boolean(value))
  return description ?? (info.title?.replace(/\s+\(@[^)]+ subagent\)$/, "") || fallback)
}

export const taskSession = (state: ChatState.State, parentID: string, tool: SessionMessage.Tool) => {
  const metadata = ToolState.metadata(tool)
  const id = string(metadata.sessionID) ?? string(metadata.sessionId)
  if (id?.startsWith("ses_")) return id
  const description = string(ToolState.input(tool).description) ?? ""
  return Object.values(state.info)
    .filter((info) => info.parentID === parentID && (info.title ?? "").startsWith(description))
    .reduce<SessionInfo.Info | undefined>(
      (newest, info) =>
        newest && DateTime.toEpochMillis(newest.time.created) >= DateTime.toEpochMillis(info.time.created)
          ? newest
          : info,
      undefined,
    )?.id
}

const isWork = (part: SessionMessage.Content): part is SessionMessage.Tool =>
  part.type === "tool" && (part.name === "subagent" || part.name === "shell")

export const background = (state: ChatState.State, sessionID: string): Background => {
  const messages = ChatState.messages(state, sessionID)
  const completed = new Set(
    messages.flatMap((message) => {
      if (message.type !== "synthetic" || !message.metadata) return []
      if (message.metadata.source === "subagent") return message.metadata.childID ? [message.metadata.childID] : []
      if (message.metadata.source !== "shell") return []
      return [message.metadata.shellID, message.metadata.jobID].filter(Predicate.isString)
    }),
  )
  const running = messages.flatMap((message) =>
    message.type === "assistant"
      ? message.content
          .filter(isWork)
          .filter((part) => part.state.status === "completed" && ToolState.metadata(part).status === "running")
      : [],
  )
  const subagents = running.flatMap((part): ReadonlyArray<Task> => {
    if (part.name !== "subagent") return []
    const id = string(ToolState.metadata(part).sessionID)
    if (!id || completed.has(id)) return []
    const input = ToolState.input(part)
    const agent = string(input.agent)
    return [{ id, type: "subagent", label: string(input.description) ?? id, ...(agent && { agent }) }]
  })
  const shells = running.flatMap((part): ReadonlyArray<Task> => {
    if (part.name !== "shell") return []
    const id = string(ToolState.metadata(part).shellID) ?? part.id
    if (completed.has(part.id) || completed.has(id)) return []
    return [{ id, type: "shell", label: string(ToolState.input(part).command) ?? part.id }]
  })
  const latest = messages.findLast((message) => message.type === "assistant" && !message.time.completed)
  const blocking =
    latest?.type === "assistant"
      ? latest.content
          .filter(isWork)
          .filter((part) => part.state.status === "running")
          .map((part): Blocking => {
            const metadata = ToolState.metadata(part)
            const input = ToolState.input(part)
            return {
              type: part.name === "shell" ? "shell" : "subagent",
              partID: part.id,
              id: string(part.name === "shell" ? metadata.shellID : metadata.sessionID),
              label: string(part.name === "shell" ? input.command : input.description),
            }
          })
      : []
  const active = Object.values(state.info).flatMap((info): ReadonlyArray<Task> => {
    if (info.parentID !== sessionID || ChatState.activity(state, info.id) === "idle") return []
    if (
      blocking.some(
        (item) =>
          item.type === "subagent" && (item.id === info.id || (Boolean(item.label) && info.title === item.label)),
      )
    )
      return []
    return [{ id: info.id, type: "subagent", label: info.title ?? info.id }]
  })
  const live = ChatState.shells(state, sessionID).flatMap((shell): ReadonlyArray<Task> => {
    if (shell.status !== "running") return []
    if (
      blocking.some(
        (item) =>
          item.type === "shell" && (item.id === shell.id || (Boolean(item.label) && shell.command === item.label)),
      )
    )
      return []
    return [{ id: shell.id, type: "shell", label: shell.command }]
  })
  return {
    blocking,
    tasks: [...new Map([...subagents, ...active, ...shells, ...live].map((task) => [task.id, task])).values()],
  }
}

export type Attention = "asking" | "running" | "idle"

export const attention = (state: ChatState.State, sessionID: string): Attention => {
  if (permission(state, sessionID) ?? form(state, sessionID)) return "asking"
  const ids = tree(state, sessionID)
  const working = ids.some(
    (id) =>
      ChatState.activity(state, id) === "running" ||
      ChatState.pending(state, id).some((item) => item.type !== "synthetic"),
  )
  return working ? "running" : "idle"
}

export type SubagentStatus = "delegating" | "running" | "completed" | "failed"

export interface Subagent {
  readonly child: string | undefined
  readonly title: string
  readonly description: string | undefined
  readonly status: SubagentStatus
  readonly background: boolean
  readonly needsInput: boolean
  readonly tools: number
  readonly activity?: string
}

const subagentStatus = (tool: SessionMessage.Tool, running: boolean): SubagentStatus => {
  if (tool.state.status === "streaming") return "delegating"
  if (tool.state.status === "running" || running) return "running"
  return ToolState.failed(tool) ? "failed" : "completed"
}

const toolsOf = (state: ChatState.State, sessionID: string | undefined) =>
  sessionID
    ? ChatState.messages(state, sessionID).flatMap((message) =>
        message.type === "assistant"
          ? message.content.filter((content): content is SessionMessage.Tool => content.type === "tool")
          : [],
      )
    : []

export const subagent = (state: ChatState.State, parentID: string, tool: SessionMessage.Tool): Subagent => {
  const child = taskSession(state, parentID, tool)
  const input = ToolState.input(tool)
  const agent = string(input.agent) ?? string(input.subagent_type)
  const background = tool.state.status === "completed" && ToolState.metadata(tool).status === "running"
  const status = subagentStatus(tool, background || (child ? ChatState.activity(state, child) === "running" : false))
  const tools = toolsOf(state, child)
  const current = status === "running" ? tools.findLast((item) => item.state.status !== "streaming") : undefined
  return {
    child,
    title: agent ? agent.slice(0, 1).toUpperCase() + agent.slice(1) : "Subagent",
    description: string(input.description) ?? child,
    status,
    background,
    needsInput: child ? Boolean(permission(state, child) ?? form(state, child)) : false,
    tools: tools.length,
    ...(current && { activity: [ToolDisplay.name(current), ToolDisplay.subtitle(current)].filter(Boolean).join(" ") }),
  }
}
