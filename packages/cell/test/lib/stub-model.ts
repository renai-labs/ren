export * as StubModel from "./stub-model.js"

import { Effect, Option, Schema } from "effect"

interface Behaviour {
  readonly reply?: string
  readonly hold?: boolean
  readonly status?: number
  readonly rejectKey?: string
  readonly cut?: boolean
  readonly malformed?: boolean
  readonly dripMs?: number
  readonly tool?: { readonly name: string; readonly input: unknown }
  readonly tools?: ReadonlyArray<{ readonly name: string; readonly input: unknown }>
  readonly summary?: string
  readonly reasoning?: string
}

export interface Call {
  readonly kind: "title" | "compaction" | "turn"
  readonly path: string
  readonly marker: string | undefined
  readonly text: string
  readonly system: string
  readonly tools: ReadonlyArray<string>
  readonly authorization: string | null
  readonly apiKey: string | null
  readonly body: ChatRequest
}

export interface Script {
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

const Message = Schema.Struct({
  role: Schema.String,
  content: Schema.optional(Content),
  tool_calls: Schema.optional(
    Schema.Array(Schema.Struct({ function: Schema.Struct({ name: Schema.String, arguments: Schema.String }) })),
  ),
})

const ChatRequest = Schema.Struct({
  model: Schema.String,
  messages: Schema.Array(Message),
  tools: Schema.optional(
    Schema.Array(
      Schema.Struct({
        function: Schema.Struct({
          name: Schema.String,
          description: Schema.optional(Schema.String),
          parameters: Schema.optional(Schema.Unknown),
        }),
      }),
    ),
  ),
})
interface ChatRequest extends Schema.Schema.Type<typeof ChatRequest> {}

const MessagesRequest = Schema.Struct({
  model: Schema.String,
  system: Content.pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  messages: Schema.Array(Message),
  tools: Schema.Array(Schema.Struct({ name: Schema.String })).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
})

const text = (content: typeof Content.Type | undefined) => {
  if (typeof content === "string") return content
  if (!content) return ""
  return content.flatMap((part) => (part.text === undefined ? [] : [part.text])).join("\n")
}

const markerPattern = /stub_[0-9a-f]{12}/

export const restarted =
  "The server restarted while you were working. Continue from where you left off without repeating completed work."

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

const event = (data: { readonly type: string } & Record<string, unknown>) =>
  encoder.encode(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`)

async function* messages(text: string) {
  yield event({
    type: "message_start",
    message: {
      id: "msg_stub",
      type: "message",
      role: "assistant",
      model: "stub",
      content: [],
      usage: { input_tokens: 10, output_tokens: 0 },
    },
  })
  yield event({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })
  yield* text
    .split(/(?<= )/)
    .map((word) => event({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: word } }))
  yield event({ type: "content_block_stop", index: 0 })
  yield event({
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: 5 },
  })
  yield event({ type: "message_stop" })
}

const toCall = (body: ChatRequest, request: Request): Call => {
  const system = body.messages
    .filter((message) => message.role === "system")
    .map((message) => text(message.content))
    .join("\n")
  const prompts = body.messages.filter((message) => message.role === "user").map((message) => text(message.content))
  const prompt = prompts.at(-1) ?? ""
  const summarizes = prompt.includes("## Objective")
  const kind = summarizes ? "compaction" : "turn"
  return {
    kind: system.includes("title generator") ? "title" : kind,
    path: new URL(request.url).pathname,
    marker: (prompt === restarted || summarizes
      ? prompts.findLast((candidate) => markerPattern.test(candidate))
      : prompt
    )?.match(markerPattern)?.[0],
    text: prompt,
    system,
    tools: body.tools?.map((tool) => tool.function.name) ?? [],
    authorization: request.headers.get("authorization"),
    apiKey: request.headers.get("x-api-key"),
    body,
  }
}

async function* reply(body: ChatRequest, behaviour: Behaviour, gate: Promise<void>) {
  const last = body.messages.findLastIndex((message) => message.role === "user")
  const results = body.messages.slice(last + 1).filter((message) => message.role === "tool").length
  const tool = (behaviour.tools ?? (behaviour.tool ? [behaviour.tool] : [])).at(results)
  const words = tool ? [] : (behaviour.reply ?? "stub reply").split(/(?<= )/)
  const pause = () => (behaviour.dripMs ? Bun.sleep(behaviour.dripMs) : Promise.resolve())
  yield chunk({ role: "assistant", content: "" })
  await pause()
  if (behaviour.malformed) yield encoder.encode("data: {not json\n\n")
  if (behaviour.reasoning) yield chunk({ reasoning_content: behaviour.reasoning })
  if (tool) {
    const input = JSON.stringify(tool.input)
    const half = Math.floor(input.length / 2)
    yield chunk({
      tool_calls: [
        {
          index: 0,
          id: `call_${crypto.randomUUID().slice(0, 8)}`,
          type: "function",
          function: { name: tool.name, arguments: input.slice(0, half) },
        },
      ],
    })
    yield chunk({ tool_calls: [{ index: 0, function: { arguments: input.slice(half) } }] })
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

interface Endpoint {
  readonly decode: (json: unknown) => Option.Option<ChatRequest>
  readonly stream: (body: ChatRequest, behaviour: Behaviour, gate: Promise<void>) => AsyncGenerator<Uint8Array>
}

const endpoints: Readonly<Record<string, Endpoint>> = {
  "/v1/chat/completions": { decode: Schema.decodeUnknownOption(ChatRequest), stream: reply },
  "/v1/messages": {
    decode: (json) =>
      Option.map(Schema.decodeUnknownOption(MessagesRequest)(json), (body) => ({
        model: body.model,
        messages: [{ role: "system", content: body.system }, ...body.messages],
        tools: body.tools.map((tool) => ({ function: { name: tool.name } })),
      })),
    stream: (_body, behaviour) => messages(behaviour.reply ?? "stub reply"),
  },
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

export const keyOf = (call: Pick<Call, "apiKey" | "authorization">) =>
  call.apiKey ?? call.authorization?.replace(/^Bearer /, "") ?? null

const statusOf = (behaviour: Behaviour, call: Call) =>
  behaviour.rejectKey && keyOf(call) === behaviour.rejectKey ? 401 : behaviour.status

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
    const entry = call.kind !== "title" && call.marker ? scripts.get(call.marker) : undefined
    if (call.kind === "turn") entry?.calls.push(call)
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
      const endpoint = Object.entries(endpoints).find((entry) => new URL(request.url).pathname.endsWith(entry[0]))?.[1]
      if (!endpoint) return new Response("not found", { status: 404 })
      const decoded = endpoint.decode(await request.json().catch(() => undefined))
      if (Option.isNone(decoded)) return new Response("not a chat completion or messages request", { status: 400 })
      const call = toCall(decoded.value, request)
      const entry = record(call)
      const summary = entry?.behaviour.summary
      const behaviour: Behaviour = {
        title: { reply: "Stub title" },
        compaction: summary === undefined ? {} : { reply: summary },
        turn: entry?.behaviour ?? {},
      }[call.kind]
      const status = statusOf(behaviour, call)
      if (status)
        return Response.json({ error: { message: `stub model status ${status}`, type: "stub_error" } }, { status })
      const chunks = endpoint.stream(call.body, behaviour, entry?.gate.promise ?? Promise.resolve())
      const body = new ReadableStream<Uint8Array>({
        pull: async (controller) => {
          const next = await chunks.next()
          if (next.done) controller.close()
          else controller.enqueue(next.value)
        },
      })
      return new Response(body, { headers: { "content-type": "text/event-stream" } })
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
