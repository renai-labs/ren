export * as ModelProvider from "./model.js"

import { StubModel } from "@ren/cell/testing"
import { Option, Schema } from "effect"
import { createHash } from "node:crypto"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { Duplex } from "node:stream"
import { Wait } from "../wait.js"

export type Step =
  | { readonly type: "text"; readonly text: string; readonly dripMs?: number; readonly hold?: boolean }
  | { readonly type: "tool"; readonly name: string; readonly input: unknown; readonly hold?: boolean }
  | { readonly type: "status"; readonly status: number; readonly headers?: Readonly<Record<string, string>> }
  | { readonly type: "cut"; readonly after: "headers" | "text" }
  | { readonly type: "malformed-frame" }
  | { readonly type: "malformed-arguments"; readonly name: string }
  | { readonly type: "eof" }

export const text = (value: string, options: { readonly dripMs?: number; readonly hold?: boolean } = {}): Step => ({
  type: "text",
  text: value,
  ...options,
})

export const tool = (name: string, input: unknown, options: { readonly hold?: boolean } = {}): Step => ({
  type: "tool",
  name,
  input,
  ...options,
})

export const status = (code: number, headers?: Readonly<Record<string, string>>): Step => ({
  type: "status",
  status: code,
  ...(headers && { headers }),
})

export const cut = (after: "headers" | "text"): Step => ({ type: "cut", after })

const Content = Schema.Union([
  Schema.String,
  Schema.Null,
  Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) })),
])

const ChatRequest = Schema.Struct({
  model: Schema.String,
  messages: Schema.Array(Schema.Struct({ role: Schema.String, content: Schema.optional(Content) })),
  tools: Schema.optional(Schema.Array(Schema.Struct({ function: Schema.Struct({ name: Schema.String }) }))),
})

const decodeRequest = Schema.decodeUnknownOption(Schema.fromJsonString(ChatRequest))

const ResponsesRequest = Schema.Struct({
  model: Schema.String,
  instructions: Schema.optional(Schema.String),
  input: Schema.Array(Schema.Struct({ role: Schema.optional(Schema.String), content: Schema.optional(Content) })),
})

const decodeResponsesRequest = Schema.decodeUnknownOption(Schema.fromJsonString(ResponsesRequest))

const fromResponses = (body: typeof ResponsesRequest.Type): typeof ChatRequest.Type => ({
  model: body.model,
  messages: [
    ...(body.instructions === undefined ? [] : [{ role: "system", content: body.instructions }]),
    ...body.input.map((item) => ({
      role: item.role === "developer" ? "system" : (item.role ?? ""),
      content: item.content,
    })),
  ],
})

const flatten = (content: typeof Content.Type | undefined) => {
  if (typeof content === "string") return content
  if (!content) return ""
  return content.flatMap((part) => (part.text === undefined ? [] : [part.text])).join("\n")
}

interface Call {
  readonly marker: string | undefined
  readonly kind: "title" | "turn"
  readonly model: string
  readonly system: string
  readonly key: string | undefined
  readonly tools: ReadonlyArray<string>
  readonly prompt: string
  readonly toolResults: string
  readonly at: number
}

interface Script {
  readonly marker: string
  readonly calls: ReadonlyArray<Call>
  readonly called: (count?: number, ms?: number) => Promise<Call>
  readonly release: () => void
}

export interface Instance {
  readonly url: string
  readonly modelInfo: {
    readonly set: (models: ReadonlyArray<StubModel.ModelInfoEntry>) => void
    readonly down: (isDown: boolean) => void
  }
  readonly calls: ReadonlyArray<Call>
  readonly upgrades: ReadonlyArray<string>
  readonly script: (steps?: ReadonlyArray<Step>) => Script
  readonly stop: () => Promise<void>
}

interface Entry {
  readonly steps: ReadonlyArray<Step>
  readonly calls: Array<Call>
  gate: PromiseWithResolvers<void>
}

const encoder = new TextEncoder()

const frame = (data: unknown) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`)

const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
  frame({
    id: "chatcmpl-chaos",
    object: "chat.completion.chunk",
    created: 0,
    model: "chaos",
    choices: [{ index: 0, delta, finish_reason: finish }],
  })

const usage = frame({
  id: "chatcmpl-chaos",
  object: "chat.completion.chunk",
  created: 0,
  model: "chaos",
  choices: [],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
})

const done = encoder.encode("data: [DONE]\n\n")

const event = (data: { readonly type: string } & Record<string, unknown>) =>
  encoder.encode(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`)

async function* responsesText(step: Step): AsyncGenerator<Uint8Array, undefined> {
  if (step.type !== "text") throw new Error(`the Responses route serves text and status steps, not ${step.type}`)
  const value = step.text
  const message = { type: "message", id: "msg_chaos", role: "assistant", status: "in_progress", content: [] }
  yield event({ type: "response.output_item.added", output_index: 0, item: message })
  yield* value
    .split(/(?<= )/)
    .map((word) => event({ type: "response.output_text.delta", item_id: message.id, output_index: 0, delta: word }))
  yield event({
    type: "response.output_item.done",
    output_index: 0,
    item: { ...message, status: "completed", content: [{ type: "output_text", text: value, annotations: [] }] },
  })
  yield event({
    type: "response.completed",
    response: {
      id: "resp_chaos",
      status: "completed",
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    },
  })
  return undefined
}

const websocketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

const refuseWebSocket = (request: IncomingMessage, socket: Duplex) => {
  const accept = createHash("sha1")
    .update(`${request.headers["sec-websocket-key"] ?? ""}${websocketGuid}`)
    .digest("base64")
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  )
  // oxlint-disable-next-line ren/no-comments -- A close frame with code 1011 after the first request, as the inference service sends.
  socket.once("data", () => socket.end(Uint8Array.of(0x88, 0x02, 0x03, 0xf3)))
}

const toolCall = (name: string, input: string) =>
  chunk({
    tool_calls: [
      {
        index: 0,
        id: `call_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`,
        type: "function",
        function: { name, arguments: input },
      },
    ],
  })

async function* words(step: Extract<Step, { readonly type: "text" }>, gate: Promise<void>) {
  const split = step.text.split(/(?<= )/)
  yield chunk({ content: split[0] ?? "" })
  if (step.hold) await gate
  for (const word of split.slice(1)) {
    // oxlint-disable-next-line no-await-in-loop -- chunks are sent one after another with the configured pause
    if (step.dripMs) await Bun.sleep(step.dripMs)
    yield chunk({ content: word })
  }
  yield chunk({}, "stop")
}

async function* respond(step: Step, gate: Promise<void>): AsyncGenerator<Uint8Array, "cut" | undefined> {
  yield chunk({ role: "assistant", content: "" })
  if (step.type === "cut") {
    if (step.after === "text") yield chunk({ content: "partial " })
    return "cut"
  }
  if (step.type === "malformed-frame") yield encoder.encode("data: {not json\n\n")
  if (step.type === "eof") yield chunk({ content: "partial " })
  if (step.type !== "text" && step.type !== "tool" && step.type !== "malformed-arguments") return undefined
  if (step.type === "text") yield* words(step, gate)
  else {
    if (step.type === "tool" && step.hold) await gate
    yield toolCall(step.name, step.type === "tool" ? JSON.stringify(step.input) : "{nope")
    yield chunk({}, "tool_calls")
  }
  yield usage
  yield done
  return undefined
}

const routes: Readonly<
  Record<
    string,
    {
      readonly decode: (body: string) => Option.Option<typeof ChatRequest.Type>
      readonly stream: (step: Step, gate: Promise<void>) => AsyncGenerator<Uint8Array, "cut" | undefined>
    }
  >
> = {
  "/chat/completions": { decode: decodeRequest, stream: respond },
  "/responses": { decode: (body) => Option.map(decodeResponsesRequest(body), fromResponses), stream: responsesText },
}

const markerPattern = /chaos_[0-9a-f]{12}/g

const toCall = (body: typeof ChatRequest.Type, authorization: string, known: (marker: string) => boolean): Call => {
  const system = body.messages
    .filter((message) => message.role === "system")
    .map((message) => flatten(message.content))
    .join("\n")
  const kind = system.includes("title generator") ? ("title" as const) : ("turn" as const)
  return {
    marker:
      kind === "turn"
        ? body.messages
            .filter((message) => message.role === "user")
            .flatMap((message) => [...flatten(message.content).matchAll(markerPattern)].map((match) => match[0]))
            .findLast(known)
        : undefined,
    kind,
    model: body.model,
    system,
    key: /^Bearer\s+(\S+)$/i.exec(authorization)?.[1],
    tools: body.tools?.map((item) => item.function.name) ?? [],
    prompt: flatten(body.messages.findLast((message) => message.role === "user")?.content),
    toolResults: body.messages
      .slice(body.messages.findLastIndex((message) => message.role === "user") + 1)
      .filter((message) => message.role === "tool")
      .map((message) => flatten(message.content))
      .join("\n"),
    at: Date.now(),
  }
}

const readBody = (request: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    const chunks: Array<Buffer> = []
    request
      .on("data", (part: Buffer) => chunks.push(part))
      .on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
      .on("error", reject)
  })

const send = async (response: ServerResponse, stream: AsyncGenerator<Uint8Array, "cut" | undefined>) => {
  response.writeHead(200, { "content-type": "text/event-stream" })
  response.flushHeaders()
  const pump = async (): Promise<void> => {
    const next = await stream.next()
    if (!next.done) {
      await new Promise((resolve) => response.write(next.value, resolve))
      return pump()
    }
    if (next.value !== "cut") return void response.end()
    // oxlint-disable-next-line ren/no-comments -- Bun's fetch drops bytes that arrive with the reset, so a cut gives the reader time to take them first.
    await Bun.sleep(50)
    response.socket?.destroy()
  }
  return pump()
}

const settled = Promise.withResolvers<void>()
settled.resolve()

export const start = async (): Promise<Instance> => {
  const calls: Array<Call> = []
  const upgrades: Array<string> = []
  const upgraded = new Set<Duplex>()
  const scripts = new Map<string, Entry>()

  const info = { models: StubModel.defaultModels, isDown: false }
  const modelInfo = (response: ServerResponse) => {
    response.writeHead(info.isDown ? 503 : 200, { "content-type": "application/json" })
    response.end(info.isDown ? "{}" : JSON.stringify({ data: info.models }))
  }
  const chat = async (request: IncomingMessage, response: ServerResponse) => {
    const route = Object.entries(routes).find((entry) => request.url?.endsWith(entry[0]))?.[1]
    const decoded = route ? route.decode(await readBody(request)) : Option.none()
    if (!route || Option.isNone(decoded)) {
      response.writeHead(404)
      return void response.end()
    }
    const call = toCall(decoded.value, request.headers.authorization ?? "", (marker) => scripts.has(marker))
    const entry = scripts.get(call.marker ?? "") ?? {
      steps: [text(call.kind === "title" ? "Chaos title" : "done")],
      calls: [],
      gate: settled,
    }
    const step = entry.steps[entry.calls.length] ?? text("done")
    calls.push(call)
    entry.calls.push(call)
    if (step.type !== "status") return send(response, route.stream(step, entry.gate.promise))
    response.writeHead(step.status, { "content-type": "application/json", ...step.headers })
    response.end(JSON.stringify({ error: { message: `chaos provider status ${step.status}`, type: "chaos_error" } }))
  }

  const server = createServer((request, response) =>
    request.url === "/model/info"
      ? modelInfo(response)
      : void chat(request, response).catch(() => response.socket?.destroy()),
  )
  server.on("upgrade", (request: IncomingMessage, socket: Duplex) => {
    upgrades.push(request.url ?? "")
    upgraded.add(socket.once("close", () => upgraded.delete(socket)))
    refuseWebSocket(request, socket)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()

  return {
    url: `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}/v1`,
    modelInfo: {
      set: (models) => {
        info.models = models
      },
      down: (isDown) => {
        info.isDown = isDown
      },
    },
    calls,
    upgrades,
    script: (steps = [text("done")]) => {
      const marker = `chaos_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`
      const entry: Entry = { steps, calls: [], gate: Promise.withResolvers<void>() }
      scripts.set(marker, entry)
      return {
        marker,
        calls: entry.calls,
        called: (count = 1, ms = 30_000) =>
          Wait.until(
            `model call ${count} for ${marker}`,
            ms,
            () => entry.calls[count - 1],
            () => `${entry.calls.length} calls for this script, ${calls.length} in all`,
          ),
        release: () => {
          entry.gate.resolve()
          entry.gate = Promise.withResolvers<void>()
        },
      }
    },
    stop: async () => {
      for (const entry of scripts.values()) entry.gate.resolve()
      server.closeAllConnections()
      for (const socket of upgraded) socket.destroy()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}
