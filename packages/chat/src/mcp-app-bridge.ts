export * as McpAppBridge from "./mcp-app-bridge.js"

import type { SessionMessage } from "@ren/schema/session/message"
import { Option, Predicate, Schema } from "effect"
import { ToolState } from "./tool-state.js"

export const protocolVersion = "2026-01-26"

export const maxCallsPerMinute = 30

const Message = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number])),
  method: Schema.String,
  params: Schema.optionalKey(Schema.Unknown),
})

export type Message = typeof Message.Type

export const decode = Schema.decodeUnknownOption(Message)

const ToolCall = Schema.Struct({
  name: Schema.NonEmptyString,
  arguments: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
})

const Text = Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })

const Post = Schema.Struct({ content: Schema.Union([Text, Schema.Array(Text)]) })

const OpenLink = Schema.Struct({ url: Schema.String })

const Size = Schema.Struct({ height: Schema.Finite })

export const toolCall = Schema.decodeUnknownOption(ToolCall)

export const postText = (params: unknown) =>
  Option.map(Schema.decodeUnknownOption(Post)(params), (post) =>
    (Array.isArray(post.content) ? post.content : [post.content]).map((part) => part.text).join("\n"),
  )

export const link = (params: unknown) =>
  Option.flatMap(Schema.decodeUnknownOption(OpenLink)(params), (found) =>
    URL.canParse(found.url) && new URL(found.url).protocol === "https:" ? Option.some(found.url) : Option.none(),
  )

export const height = (params: unknown) =>
  Option.map(Schema.decodeUnknownOption(Size)(params), (size) => Math.max(0, Math.ceil(size.height)))

export const reply = (id: string | number, result: unknown) => ({ jsonrpc: "2.0", id, result })

export const fail = (id: string | number, message: string, code = -32000) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
})

export const notify = (method: string, params: unknown) => ({ jsonrpc: "2.0", method, params })

export const admit = (calls: ReadonlyArray<number>, now: number) => {
  const recent = calls.filter((at) => now - at < 60_000)
  return recent.length < maxCallsPerMinute ? [...recent, now] : undefined
}

const host = /^https:\/\/(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*(?::\d{1,5})?$/iu

export const domains = (declared: ReadonlyArray<string>) => declared.filter((domain) => host.test(domain))

export const policy = (declared: SessionMessage.McpAppView["app"]["domains"]) => {
  const connect = domains(declared.connect)
  const resource = domains(declared.resource)
  const list = (...sources: ReadonlyArray<string>) => sources.join(" ")
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline'`,
    `style-src ${list("'unsafe-inline'", ...resource)}`,
    `font-src ${list("data:", ...resource)}`,
    `img-src ${list("data:", "blob:", ...resource)}`,
    `media-src ${list("data:", "blob:", ...resource)}`,
    `connect-src ${list(...(connect.length > 0 ? connect : ["'none'"]))}`,
    "form-action 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
  ].join("; ")
}

const parseObject = (text: string) => {
  const parsed = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(text)
  return Option.filter(parsed, Predicate.isObject)
}

type Block =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly mimeType: string; readonly data: string }

export const contentOf = (content: ReadonlyArray<SessionMessage.ToolContent>) =>
  content.flatMap((part): Block[] => {
    if (part.type === "text") return [{ type: "text", text: part.text }]
    const image = /^data:(image\/[^;,]+);base64,(.*)$/su.exec(part.uri)
    const mimeType = image?.at(1)
    const data = image?.at(2)
    return mimeType && data ? [{ type: "image", mimeType, data }] : []
  })

export const callResult = (result: {
  readonly output?: unknown
  readonly content: ReadonlyArray<SessionMessage.ToolContent>
}) => ({
  content: contentOf(result.content),
  ...(Predicate.isObject(result.output) && !Array.isArray(result.output) && { structuredContent: result.output }),
})

export const toolResult = (tool: SessionMessage.Tool) => {
  const content = "content" in tool.state ? (tool.state.content ?? []) : []
  const first = content.flatMap((part) => (part.type === "text" ? [part.text] : [])).at(0)
  const structured = first ? Option.getOrUndefined(parseObject(first)) : undefined
  return {
    content: contentOf(content),
    ...(structured && !Array.isArray(structured) && { structuredContent: structured }),
    ...(ToolState.failed(tool) && { isError: true }),
  }
}

export const failure = (message: string) => ({ isError: true, content: [{ type: "text", text: message }] })
