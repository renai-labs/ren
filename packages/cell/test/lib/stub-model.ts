export * as StubModel from "./stub-model.js"

import { Option, Schema } from "effect"

interface Behaviour {
  readonly reply?: string
  readonly hold?: boolean
  readonly status?: number
  readonly cut?: boolean
  readonly malformed?: boolean
  readonly dripMs?: number
  readonly tool?: { readonly name: string; readonly input: unknown }
}

interface Call {
  readonly kind: "title" | "turn"
  readonly marker: string | undefined
  readonly text: string
  readonly system: string
  readonly tools: ReadonlyArray<string>
  readonly authorization: string | null
  readonly body: ChatRequest
}

interface Script {
  readonly marker: string
  readonly calls: ReadonlyArray<Call>
  readonly set: (behaviour: Behaviour) => void
  readonly release: () => void
  readonly called: (count?: number) => Promise<Call>
}

export interface Server {
  readonly url: string
  readonly cellUrl: string
  readonly calls: ReadonlyArray<Call>
  readonly script: (behaviour?: Behaviour) => Script
  readonly waitFor: (predicate: (call: Call) => boolean) => Promise<Call>
  readonly stop: () => Promise<void>
}

const Content = Schema.Union([
  Schema.String,
  Schema.Null,
  Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) })),
])

const Message = Schema.Struct({ role: Schema.String, content: Schema.optional(Content) })

const ChatRequest = Schema.Struct({
  model: Schema.String,
  messages: Schema.Array(Message),
  tools: Schema.optional(Schema.Array(Schema.Struct({ function: Schema.Struct({ name: Schema.String }) }))),
})
interface ChatRequest extends Schema.Schema.Type<typeof ChatRequest> {}

const text = (content: typeof Content.Type | undefined) => {
  if (typeof content === "string") return content
  if (!content) return ""
  return content.flatMap((part) => (part.text === undefined ? [] : [part.text])).join("\n")
}

const markerPattern = /stub_[0-9a-f]{12}/

const encoder = new TextEncoder()

const frame = (data: unknown) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`)

const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
  frame({
    id: "chatcmpl-stub",
    object: "chat.completion.chunk",
    created: 0,
    model: "stub",
    choices: [{ index: 0, delta, finish_reason: finish }],
  })

const usage = frame({
  id: "chatcmpl-stub",
  object: "chat.completion.chunk",
  created: 0,
  model: "stub",
  choices: [],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
})

const toCall = (body: ChatRequest, authorization: string | null): Call => {
  const system = body.messages
    .filter((message) => message.role === "system")
    .map((message) => text(message.content))
    .join("\n")
  const prompt = text(body.messages.findLast((message) => message.role === "user")?.content)
  return {
    kind: system.includes("title generator") ? "title" : "turn",
    marker: prompt.match(markerPattern)?.[0],
    text: prompt,
    system,
    tools: body.tools?.map((tool) => tool.function.name) ?? [],
    authorization,
    body,
  }
}

async function* reply(body: ChatRequest, behaviour: Behaviour, gate: Promise<void>) {
  const last = body.messages.findLastIndex((message) => message.role === "user")
  const answered = body.messages.slice(last + 1).some((message) => message.role === "tool")
  const tool = answered ? undefined : behaviour.tool
  const words = tool ? [] : (behaviour.reply ?? "stub reply").split(/(?<= )/)
  const pause = () => (behaviour.dripMs ? Bun.sleep(behaviour.dripMs) : Promise.resolve())
  yield chunk({ role: "assistant", content: "" })
  await pause()
  if (behaviour.malformed) yield encoder.encode("data: {not json\n\n")
  if (tool) {
    const call = { name: tool.name, arguments: JSON.stringify(tool.input) }
    yield chunk({
      tool_calls: [{ index: 0, id: `call_${crypto.randomUUID().slice(0, 8)}`, type: "function", function: call }],
    })
  }
  yield* words.slice(0, 1).map((word) => chunk({ content: word }))
  if (behaviour.cut) {
    // oxlint-disable-next-line ren/no-comments -- Without a turn of the event loop, Bun breaks the connection before it sends the headers and the first chunk.
    await Bun.sleep(0)
    throw new Error("stub model cut the stream")
  }
  if (behaviour.hold) await gate
  for (const word of words.slice(1)) {
    // oxlint-disable-next-line no-await-in-loop -- chunks are sent one after another, with a pause between them
    await pause()
    yield chunk({ content: word })
  }
  yield chunk({}, tool ? "tool_calls" : "stop")
  yield usage
  yield encoder.encode("data: [DONE]\n\n")
}

interface Entry {
  behaviour: Behaviour
  gate: PromiseWithResolvers<void>
  readonly calls: Array<Call>
}

interface Waiter {
  readonly predicate: (call: Call) => boolean
  readonly resolve: (call: Call) => void
}

export const start = (): Server => {
  const calls: Array<Call> = []
  const scripts = new Map<string, Entry>()
  const waiters = new Set<Waiter>()

  const waitFor = (predicate: (call: Call) => boolean) => {
    const found = calls.find(predicate)
    if (found) return Promise.resolve(found)
    const deferred = Promise.withResolvers<Call>()
    waiters.add({ predicate, resolve: deferred.resolve })
    return deferred.promise
  }

  const record = (call: Call) => {
    calls.push(call)
    const entry = call.kind === "turn" && call.marker ? scripts.get(call.marker) : undefined
    entry?.calls.push(call)
    for (const waiter of [...waiters].filter((candidate) => candidate.predicate(call))) {
      waiters.delete(waiter)
      waiter.resolve(call)
    }
    return entry
  }

  const server = Bun.serve({
    hostname: "0.0.0.0",
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response("not found", { status: 404 })
      const decoded = Schema.decodeUnknownOption(ChatRequest)(await request.json().catch(() => undefined))
      if (Option.isNone(decoded)) return new Response("not a chat completion request", { status: 400 })
      const call = toCall(decoded.value, request.headers.get("authorization"))
      const entry = record(call)
      const behaviour = call.kind === "title" ? { reply: "Stub title" } : (entry?.behaviour ?? {})
      if (behaviour.status)
        return Response.json(
          { error: { message: `stub model status ${behaviour.status}`, type: "stub_error" } },
          { status: behaviour.status },
        )
      return new Response(reply(call.body, behaviour, entry?.gate.promise ?? Promise.resolve()), {
        headers: { "content-type": "text/event-stream" },
      })
    },
  })

  return {
    url: `http://127.0.0.1:${server.port}/v1`,
    cellUrl: `http://host.docker.internal:${server.port}/v1`,
    calls,
    waitFor,
    script: (behaviour = {}) => {
      const marker = `stub_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`
      const entry: Entry = { behaviour, gate: Promise.withResolvers<void>(), calls: [] }
      scripts.set(marker, entry)
      return {
        marker,
        calls: entry.calls,
        set: (next) => {
          entry.behaviour = next
          if (next.hold) entry.gate = Promise.withResolvers<void>()
        },
        release: () => entry.gate.resolve(),
        called: (count = 1) => waitFor((call) => entry.calls.indexOf(call) === count - 1),
      }
    },
    stop: async () => {
      for (const entry of scripts.values()) entry.gate.resolve()
      await server.stop(true)
    },
  }
}
