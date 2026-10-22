export * as FaultProxy from "./proxy.js"

import { Predicate, Schema } from "effect"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { Socket } from "node:net"

type Action =
  | { readonly type: "refuse" }
  | { readonly type: "status"; readonly status: number }
  | { readonly type: "drop-response" }
  | { readonly type: "hold" }
  | { readonly type: "cut-after-bytes"; readonly bytes: number }
  | { readonly type: "cut-after-lines"; readonly lines: number }

interface Observed {
  readonly operation: string
  readonly attempt: number
  readonly body: string
  readonly authorization: string | null
}

interface Match {
  readonly operation: string | RegExp
  readonly attempt?: number
  readonly when?: (request: Observed) => boolean
}

interface Receipt {
  readonly operation: string
  readonly attempt: number
  readonly boundary: string
}

export interface Rule {
  readonly committed: Promise<Observed>
  readonly release: () => void
  readonly applied: () => boolean
  readonly expectApplied: () => Receipt
  readonly cancel: () => void
}

export interface Instance {
  readonly url: string
  readonly seen: ReadonlyArray<Observed>
  readonly count: (operation: string | RegExp) => number
  readonly inject: (match: Match, action: Action, times?: number) => Rule
  readonly partition: (on: boolean) => void
  readonly cutAll: () => number
  readonly target: (url: string) => void
  readonly stop: () => Promise<void>
}

interface Active {
  readonly match: Match
  readonly action: Action
  remaining: number
  readonly receipts: Array<Receipt>
  readonly committed: PromiseWithResolvers<Observed>
  readonly gate: PromiseWithResolvers<void>
}

const RpcRequest = Schema.Struct({ _tag: Schema.Literal("Request"), tag: Schema.String })

const decodeRequest = Schema.decodeUnknownOption(Schema.fromJsonString(RpcRequest))

const hopByHop = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-length",
  "content-encoding",
  "host",
])

const readBody = (request: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    const chunks: Array<Buffer> = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    request.on("error", reject)
  })

const forwardHeaders = (request: IncomingMessage) =>
  Object.entries(request.headers).flatMap((entry): Array<[string, string]> => {
    const value = entry[1]
    if (hopByHop.has(entry[0]) || value === undefined) return []
    return [[entry[0], Array.isArray(value) ? value.join(", ") : value]]
  })

const write = (response: ServerResponse, bytes: Uint8Array) =>
  new Promise<void>((resolve) => response.write(bytes, () => resolve()))

const cut = async (response: ServerResponse) => {
  // oxlint-disable-next-line ren/no-comments -- Bun's fetch drops bytes that arrive with the reset, so a cut gives the reader time to take them first.
  await Bun.sleep(50)
  response.socket?.destroy()
}

const matches = (match: Match, observed: Observed) =>
  (Predicate.isString(match.operation)
    ? match.operation === observed.operation
    : match.operation.test(observed.operation)) &&
  (match.attempt === undefined || match.attempt === observed.attempt) &&
  (match.when?.(observed) ?? true)

export const make = async (initialTarget: string): Promise<Instance> => {
  const state = { target: initialTarget, partitioned: false }
  const rules: Array<Active> = []
  const seen: Array<Observed> = []
  const attempts = new Map<string, number>()
  const sockets = new Set<Socket>()

  const upstream = (request: IncomingMessage, body: string) =>
    fetch(`${state.target}${request.url ?? "/"}`, {
      method: request.method ?? "GET",
      headers: forwardHeaders(request),
      ...(body.length > 0 && { body }),
      redirect: "manual",
    })

  const start = (response: ServerResponse, reply: Response) => {
    response.writeHead(
      reply.status,
      Object.fromEntries([...reply.headers.entries()].filter((entry) => !hopByHop.has(entry[0]))),
    )
    response.flushHeaders()
  }

  const pipe = async (response: ServerResponse, reply: Response, stop?: (sent: Uint8Array) => number | undefined) => {
    start(response, reply)
    const reader = reply.body?.getReader()
    if (!reader) return response.end()
    const pump = async (): Promise<void> => {
      const chunk = await reader.read()
      if (chunk.done) return void response.end()
      const value: unknown = chunk.value
      const bytes = value instanceof Uint8Array ? value : new Uint8Array()
      const limit = stop?.(bytes)
      await write(response, limit === undefined ? bytes : bytes.subarray(0, limit))
      if (limit === undefined) return pump()
      await reader.cancel().catch(() => undefined)
      await cut(response)
    }
    return pump()
  }

  const apply = async (rule: Active, observed: Observed, request: IncomingMessage, response: ServerResponse) => {
    const receipt = (boundary: string) =>
      rule.receipts.push({ operation: observed.operation, attempt: observed.attempt, boundary })
    const action = rule.action
    if (action.type === "refuse") {
      receipt("before-delivery")
      return void response.socket?.destroy()
    }
    if (action.type === "status") {
      receipt("before-delivery")
      response.writeHead(action.status, { "content-type": "application/json" })
      return void response.end("")
    }
    const reply = await upstream(request, observed.body)
    if (action.type === "drop-response" || action.type === "hold") {
      const bytes = new Uint8Array(await reply.arrayBuffer())
      rule.committed.resolve(observed)
      if (action.type === "drop-response") {
        receipt("after-commit-before-reply")
        return void response.socket?.destroy()
      }
      receipt("after-commit-held")
      await rule.gate.promise
      return pipe(response, new Response(bytes, { status: reply.status, headers: reply.headers }))
    }
    rule.committed.resolve(observed)
    if (action.type === "cut-after-bytes") {
      receipt(`response-byte-${action.bytes}`)
      const sent = { bytes: 0 }
      return pipe(response, reply, (chunk) => {
        const room = action.bytes - sent.bytes
        sent.bytes += chunk.length
        return chunk.length < room ? undefined : room
      })
    }
    receipt(`response-line-${action.lines}`)
    const sent = { lines: 0 }
    return pipe(response, reply, (chunk) => {
      const ends = chunk.reduce<Array<number>>(
        (found, byte, index) => (byte === 10 ? [...found, index + 1] : found),
        [],
      )
      const room = action.lines - sent.lines
      sent.lines += ends.length
      return ends.length < room ? undefined : ends[room - 1]
    })
  }

  const server = createServer((request, response) => {
    void (async () => {
      if (state.partitioned) return void request.socket.destroy()
      const body = await readBody(request)
      const path = new URL(request.url ?? "/", "http://proxy").pathname
      const rpc = decodeRequest(body.split("\n")[0] ?? "")
      const operation = rpc._tag === "Some" ? rpc.value.tag : `${request.method ?? "GET"} ${path}`
      const attempt = (attempts.get(operation) ?? 0) + 1
      attempts.set(operation, attempt)
      const observed: Observed = { operation, attempt, body, authorization: request.headers.authorization ?? null }
      seen.push(observed)
      const rule = rules.find((candidate) => candidate.remaining > 0 && matches(candidate.match, observed))
      if (!rule) return pipe(response, await upstream(request, body))
      rule.remaining -= 1
      return apply(rule, observed, request, response)
    })().catch(() => {
      if (!response.headersSent) {
        response.writeHead(502)
        return void response.end()
      }
      response.socket?.destroy()
    })
  })
  server.keepAliveTimeout = 1_000
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  const port = typeof address === "object" && address !== null ? address.port : 0

  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    count: (operation) =>
      seen.filter((entry) =>
        Predicate.isString(operation) ? entry.operation === operation : operation.test(entry.operation),
      ).length,
    inject: (match, action, times = 1) => {
      const rule: Active = {
        match,
        action,
        remaining: times,
        receipts: [],
        committed: Promise.withResolvers<Observed>(),
        gate: Promise.withResolvers<void>(),
      }
      rules.push(rule)
      return {
        committed: rule.committed.promise,
        release: () => rule.gate.resolve(),
        applied: () => rule.receipts.length > 0,
        expectApplied: () => {
          const first = rule.receipts.at(0)
          if (!first) throw new Error(`the ${action.type} fault on ${String(match.operation)} was never applied`)
          return first
        },
        cancel: () => {
          rule.remaining = 0
          rule.gate.resolve()
        },
      }
    },
    partition: (on) => {
      state.partitioned = on
    },
    cutAll: () => {
      const count = sockets.size
      for (const socket of sockets) socket.destroy()
      return count
    },
    target: (url) => {
      state.target = url
    },
    stop: async () => {
      for (const rule of rules) rule.gate.resolve()
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
