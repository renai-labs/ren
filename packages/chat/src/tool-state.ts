export * as ToolState from "./tool-state.js"

import type { SessionMessage } from "@ren/schema/session/message"
import { Shell } from "@ren/schema/shell"
import { Option, Predicate, Schema } from "effect"

const decodeInput = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))

const empty: Readonly<Record<string, unknown>> = {}

export const input = (tool: SessionMessage.Tool): Readonly<Record<string, unknown>> =>
  tool.state.status === "streaming" ? Option.getOrElse(decodeInput(tool.state.input), () => empty) : tool.state.input

export const metadata = (tool: SessionMessage.Tool): Readonly<Record<string, unknown>> =>
  "metadata" in tool.state ? (tool.state.metadata ?? empty) : empty

export const output = (tool: SessionMessage.Tool) => {
  if (tool.state.status === "running") {
    const running = tool.state.metadata.output
    return typeof running === "string" ? running : undefined
  }
  if (!("content" in tool.state)) return
  return tool.state.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n") || undefined
}

const saved: ReadonlySet<unknown> = new Set(["exited", "timeout", "killed"])

const isShellID = Schema.is(Shell.ID)

export const liveShellID = (tool: SessionMessage.Tool) => {
  const values = metadata(tool)
  if (tool.name !== "shell" || saved.has(values.status) || !isShellID(values.shellID)) return
  return values.shellID
}

export const error = (tool: SessionMessage.Tool) =>
  tool.state.status === "error" ? tool.state.error.message : undefined

export const shellFailed = (values: Readonly<Record<string, unknown>>) =>
  values.timeout === true || (typeof values.exit === "number" && values.exit !== 0)

export const executeFailed = (values: Readonly<Record<string, unknown>>) => {
  const calls = values.toolCalls
  return (
    values.error === true ||
    (Array.isArray(calls) &&
      calls.some((call) => Predicate.isObject(call) && "status" in call && call.status === "error"))
  )
}

export const failed = (tool: SessionMessage.Tool) =>
  tool.state.status === "error" ||
  (tool.name === "execute" && executeFailed(metadata(tool))) ||
  (tool.name === "shell" && tool.state.status === "completed" && shellFailed(metadata(tool)))

export const hasLoadedFiles = (tool: SessionMessage.Tool) => {
  if (tool.name !== "read" || tool.state.status !== "completed") return false
  const loaded = tool.state.metadata?.loaded
  return Array.isArray(loaded) && loaded.some((path) => typeof path === "string")
}

export const imagePath = (values: Readonly<Record<string, unknown>>) => {
  const path = values.path
  if (typeof path !== "string" || !/\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i.test(path)) return
  return path.replaceAll("\\", "/")
}

export const groupedRead = (tool: SessionMessage.Tool) =>
  tool.name === "read" && tool.state.status !== "error" && !imagePath(input(tool)) && !hasLoadedFiles(tool)

export interface Expanded {
  readonly shell: boolean
  readonly edit: boolean
}

export const defaultOpen = (content: SessionMessage.Content, expanded: Expanded) => {
  if (content.type !== "tool") return
  if (content.state.status === "error") return false
  if (content.name === "shell" || content.name === "execute") return expanded.shell
  if (content.name === "patch") return expanded.edit
  if (content.name !== "edit" && content.name !== "write") return
  if (!expanded.edit) return false
  const files = metadata(content).files
  if (!Array.isArray(files) || files.length === 0) return true
  return !files.every((file) => Predicate.isObject(file) && "status" in file && file.status === "deleted")
}
