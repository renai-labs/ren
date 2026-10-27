export * as ToolDisplay from "./tool-display.js"

import type { SessionMessage } from "@ren/schema/session/message"
import { Predicate } from "effect"
import { PatchFiles } from "./patch-files.js"
import { TimelineText } from "./timeline-text.js"
import { ToolState } from "./tool-state.js"

export type Kind = "command" | "file" | "edit" | "search" | "web" | "agent" | "tool"

export type Status = "running" | "completed" | "failed"

export type GroupItem = SessionMessage.Content | { readonly type: "shell" } | { readonly type: "notice" }

const actions: Readonly<Record<string, string>> = {
  shell: "Running",
  bash: "Running",
  execute: "Executing",
  read: "Reading",
  write: "Writing",
  edit: "Editing",
  patch: "Patching",
  apply_patch: "Patching",
  glob: "Finding",
  grep: "Searching",
  list: "Listing",
  webfetch: "Fetching",
  websearch: "Searching",
  subagent: "Running task",
  task: "Running task",
  todowrite: "Updating todos",
  todoread: "Reading todos",
  question: "Asking",
  skill: "Running skill",
  plan_enter: "Planning",
  plan_exit: "Exiting plan",
  handoff: "Handing off",
  tool_search: "Searching tools",
  tool_execute: "Executing",
  ren_app_connect: "Connecting App",
  ren_search: "Searching catalog",
  ren_pod_list: "Listing teams",
  ren_pod_get: "Reading team",
  ren_agent_list: "Listing agents",
  ren_agent_save: "Saving agent",
  ren_agent_get: "Reading agent",
  ren_project_list: "Listing projects",
  ren_project_save: "Saving project",
  ren_project_get: "Reading project",
  ren_skill_save: "Saving skill",
  ren_skill_get: "Reading skill",
  ren_session_list: "Listing sessions",
  ren_session_get: "Reading session",
  ren_session_messages: "Reading messages",
  kernel_manage_browsers: "Managing browser",
  kernel_computer_action: "Using browser",
  kernel_execute_playwright_code: "Running Playwright",
  kernel_manage_replays: "Recording replay",
  kernel_browser_curl: "Fetching in browser",
  kernel_exec_command: "Running in browser VM",
}

const results: Readonly<Record<string, string>> = {
  shell: "Ran",
  bash: "Ran",
  read: "Read",
  write: "Wrote",
  edit: "Edited",
  patch: "Patched",
  apply_patch: "Patched",
  glob: "Found",
  grep: "Searched",
  list: "Listed",
  webfetch: "Fetched",
  websearch: "Searched",
  execute: "Executed",
  subagent: "Ran task",
  task: "Ran task",
  question: "Asked",
  skill: "Ran skill",
  tool_search: "Searched tools",
  tool_execute: "Executed",
}

const failures: Readonly<Record<string, string>> = {
  shell: "Failed to run",
  bash: "Failed to run",
  execute: "Failed to execute",
  read: "Failed to read",
  write: "Failed to write",
  edit: "Failed to edit",
  patch: "Failed to patch",
  apply_patch: "Failed to patch",
  glob: "Failed to find",
  grep: "Failed to search",
  list: "Failed to list",
  webfetch: "Failed to fetch",
  websearch: "Failed to search",
  subagent: "Failed to run task",
  task: "Failed to run task",
  question: "Not answered",
}

const kinds: Readonly<Record<string, Kind>> = {
  shell: "command",
  bash: "command",
  execute: "command",
  kernel_exec_command: "command",
  read: "file",
  write: "edit",
  edit: "edit",
  patch: "edit",
  apply_patch: "edit",
  grep: "search",
  glob: "search",
  websearch: "search",
  tool_search: "search",
  webfetch: "web",
  kernel_browser_curl: "web",
  subagent: "agent",
  task: "agent",
}

const names: Readonly<Record<string, string>> = {
  read: "Read",
  list: "List",
  glob: "Glob",
  grep: "Grep",
  subagent: "Agent",
  task: "Agent",
  webfetch: "Webfetch",
  shell: "Shell",
  bash: "Shell",
  execute: "Execute",
  edit: "Edit",
  write: "Write",
  skill: "Skill",
  patch: "Patch",
  apply_patch: "Patch",
  question: "Questions",
}

const providers: Readonly<Record<string, string>> = {
  tinyfish: "TinyFish",
  opencode: "OpenCode",
}

const subjectKeys = ["description", "query", "url", "path", "pattern", "name"]

const formatters: { list?: Intl.ListFormat } = {}

const lookup = <A>(table: Readonly<Record<string, A>>, key: string) =>
  Object.hasOwn(table, key) ? table[key] : undefined

const capitalize = (value: string) => value.slice(0, 1).toUpperCase() + value.slice(1)

const text = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : undefined)

const basename = (value: unknown) => {
  const path = text(value)
  return path && (path.split(/[\\/]/).at(-1) || path)
}

const count = (value: unknown, noun: string) =>
  Array.isArray(value) ? `${value.length} ${value.length === 1 ? noun : `${noun}s`}` : undefined

export const kind = (tool: SessionMessage.Tool): Kind => lookup(kinds, tool.name) ?? "tool"

export const status = (tool: SessionMessage.Tool): Status => {
  if (tool.state.status === "streaming" || tool.state.status === "running") return "running"
  return ToolState.failed(tool) ? "failed" : "completed"
}

export const hidden = (tool: SessionMessage.Tool) =>
  tool.name === "todowrite" ||
  tool.name === "todoread" ||
  (tool.name === "question" && (tool.state.status === "streaming" || tool.state.status === "running"))

export const label = (tool: SessionMessage.Tool) => {
  const action = lookup(actions, tool.name) ?? capitalize(tool.name.replaceAll(/[_-]+/g, " "))
  const state = status(tool)
  if (state === "failed") return lookup(failures, tool.name) ?? action
  return state === "completed" ? (lookup(results, tool.name) ?? action) : action
}

export const webSearchProvider = (provider: unknown) => {
  const value = text(provider)
  if (!value) return "Web search"
  return `${lookup(providers, value) ?? capitalize(value)} web search`
}

export const name = (tool: SessionMessage.Tool) =>
  tool.name === "websearch"
    ? webSearchProvider(ToolState.metadata(tool).provider)
    : (lookup(names, tool.name) ?? tool.name)

type Subject = (
  input: Readonly<Record<string, unknown>>,
  metadata: Readonly<Record<string, unknown>>,
) => string | undefined

const command: Subject = (input, metadata) => text(input.command) ?? text(metadata.command)
const file: Subject = (input) => basename(input.filePath) ?? basename(input.path)
const directory: Subject = (input) => text(input.path)
const searched: Subject = (input) => {
  const pattern = text(input.pattern)
  const path = text(input.path)
  return pattern && path ? `${pattern} in ${path}` : (pattern ?? path)
}
const files: Subject = (_input, metadata) => count(metadata.files, "file")
const delegated: Subject = (input, metadata) => text(input.description) ?? text(metadata.sessionID)

const subjects: Readonly<Record<string, Subject>> = {
  shell: command,
  bash: command,
  execute: (input) => text(input.code)?.split("\n").at(0),
  read: file,
  write: file,
  edit: file,
  glob: searched,
  grep: searched,
  list: directory,
  skill: (input, metadata) => text(metadata.name) ?? text(input.id) ?? text(input.name),
  patch: files,
  apply_patch: files,
  question: (input, metadata) =>
    Array.isArray(input.questions) && Array.isArray(metadata.answers) && metadata.answers.length > 0
      ? `${input.questions.length} answered`
      : count(input.questions, "question"),
  subagent: delegated,
  task: delegated,
}

const generic: Subject = (input) =>
  subjectKeys.map((key) => text(input[key])).find((value): value is string => Boolean(value))

export const subtitle = (tool: SessionMessage.Tool) =>
  (lookup(subjects, tool.name) ?? generic)(ToolState.input(tool), ToolState.metadata(tool))

export const output = (tool: SessionMessage.Tool) => {
  const value = ToolState.output(tool)
  return value && kind(tool) === "command" ? TimelineText.shellOutput(value) : value
}

export const error = (tool: SessionMessage.Tool) => {
  if (tool.state.status === "error") return tool.state.error.message
  if (tool.name !== "execute" || !ToolState.executeFailed(ToolState.metadata(tool))) return
  return ToolState.output(tool) ?? "Failed"
}

export const errorSummary = (tool: string, message: string) => {
  const cleaned = message.replace(/^Error:\s*/, "").trim()
  const tail = cleaned.startsWith(`${tool} `) ? cleaned.slice(tool.length + 1) : cleaned
  const head = (tail.split(": ").at(0) ?? "").trim()
  return head ? capitalize(head) : "Failed"
}

export const dismissed = (tool: SessionMessage.Tool) =>
  tool.name === "question" && Boolean(ToolState.error(tool)?.includes("dismissed this question"))

export const group = (items: ReadonlyArray<GroupItem>) => {
  const tools = items.flatMap((item) => {
    if (item.type === "shell") return ["Shell"]
    return item.type === "tool" ? [name(item)] : []
  })
  const thoughts = items.filter((item) => item.type === "reasoning").length
  if (tools.length === 0 && thoughts === 0) return { title: "Updates", count: 0 }
  const total = tools.length || thoughts
  const thought = thoughts === 1 ? "Thought" : "Thoughts"
  formatters.list ??= new Intl.ListFormat("en", { style: "long", type: "conjunction" })
  const list = formatters.list
  return { title: `Used ${total} ${tools.length ? list.format([...new Set(tools)]) : thought}`, count: total }
}

const urlPattern = /https?:\/\/[^\s<>"'`)\]]+/g

export const links = (tool: SessionMessage.Tool) =>
  tool.name === "websearch"
    ? [
        ...new Set(
          [...(ToolState.output(tool) ?? "").matchAll(urlPattern)].map((match) =>
            (match.at(0) ?? "").replaceAll(/[),.;:!?]+$/g, ""),
          ),
        ),
      ]
    : []

const questionText = (value: unknown) =>
  Predicate.isObject(value) && "question" in value && typeof value.question === "string" ? value.question : undefined

export const answers = (tool: SessionMessage.Tool) => {
  const input = ToolState.input(tool)
  const values = ToolState.metadata(tool).answers
  if (tool.name !== "question" || !Array.isArray(input.questions) || !Array.isArray(values) || values.length === 0)
    return []
  return input.questions.flatMap((item: unknown, index) => {
    const question = questionText(item)
    const answer: unknown = values[index]
    const chosen = Array.isArray(answer) ? answer.filter((value): value is string => typeof value === "string") : []
    return question ? [{ question, answer: chosen.join(", ") || "(no answer)" }] : []
  })
}

const matchKeys: Readonly<Record<string, string>> = { glob: "count", grep: "matches" }

export const matches = (tool: SessionMessage.Tool) => {
  const key = lookup(matchKeys, tool.name)
  const value = key ? ToolState.metadata(tool)[key] : undefined
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return
  return `${value} ${value === 1 ? "match" : "matches"}`
}

export const loaded = (tool: SessionMessage.Tool) => {
  if (tool.name !== "read" || tool.state.status !== "completed") return []
  const value = ToolState.metadata(tool).loaded
  return Array.isArray(value) ? value.filter((path): path is string => typeof path === "string") : []
}

export type RunKind = "read" | "file" | "skill" | "single"

export type Run =
  | { readonly type: "tools"; readonly kind: RunKind; readonly tools: ReadonlyArray<SessionMessage.Tool> }
  | { readonly type: "item"; readonly item: GroupItem }

const runKind = (tool: SessionMessage.Tool): RunKind => {
  if (PatchFiles.isFileChange(tool)) return "file"
  if (ToolState.groupedRead(tool)) return "read"
  return tool.name === "skill" && tool.state.status !== "error" && subtitle(tool) ? "skill" : "single"
}

export const runs = (items: ReadonlyArray<GroupItem>): ReadonlyArray<Run> =>
  items
    .reduce<
      Array<{ type: "item"; item: GroupItem } | { type: "tools"; kind: RunKind; tools: Array<SessionMessage.Tool> }>
    >((result, item) => {
      if (item.type !== "tool") {
        result.push({ type: "item", item })
        return result
      }
      const kind = runKind(item)
      const previous = result.at(-1)
      if (kind !== "single" && previous?.type === "tools" && previous.kind === kind) previous.tools.push(item)
      else result.push({ type: "tools", kind, tools: [item] })
      return result
    }, [])
    .map((run): Run =>
      run.type === "tools" && run.tools.length === 1 && run.kind !== "file"
        ? { type: "tools", kind: "single", tools: run.tools }
        : run,
    )
