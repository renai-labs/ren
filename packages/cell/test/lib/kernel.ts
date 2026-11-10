export * as KernelPeer from "./kernel.js"

import { Effect, Queue, Schema } from "effect"
import type { ServerWebSocket } from "bun"

const Rpc = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number])),
    method: Schema.String,
    params: Schema.optionalKey(
      Schema.Struct({ name: Schema.optionalKey(Schema.String), arguments: Schema.optionalKey(Schema.Unknown) }),
    ),
  }),
)

const Cdp = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.Number,
    method: Schema.String,
    params: Schema.optionalKey(
      Schema.Struct({ url: Schema.optionalKey(Schema.String), entryId: Schema.optionalKey(Schema.Number) }),
    ),
  }),
)

// oxlint-disable-next-line ren/no-comments -- A stand-in for Kernel: its MCP tool manage_browsers, and a CDP endpoint with one page whose history the test drives.
export const make = Effect.fnUntraced(function* () {
  const calls: Array<unknown> = []
  const sockets = new Set<ServerWebSocket>()
  const closes = yield* Queue.unbounded<void>()
  const state = { opened: 0, created: 0, history: ["https://example.com/"], index: 0 }
  const page = () => ({ targetId: "page_1", type: "page", url: state.history[state.index] ?? "", title: "Example" })
  const changed = (socket: ServerWebSocket) =>
    void socket.send(JSON.stringify({ method: "Target.targetInfoChanged", params: { targetInfo: page() } }))
  const answer = (socket: ServerWebSocket, raw: string): void => {
    const message = Schema.decodeUnknownSync(Cdp)(raw)
    const reply = (result: unknown) => void socket.send(JSON.stringify({ id: message.id, result }))
    if (message.method === "Target.setDiscoverTargets") {
      reply({})
      socket.send(JSON.stringify({ method: "Target.targetCreated", params: { targetInfo: page() } }))
      return
    }
    if (message.method === "Target.attachToTarget") return reply({ sessionId: "cdp_session_1" })
    if (message.method === "Page.getNavigationHistory")
      return reply({ currentIndex: state.index, entries: state.history.map((url, id) => ({ id, url })) })
    if (message.method === "Page.navigate") {
      state.history = [...state.history.slice(0, state.index + 1), message.params?.url ?? ""]
      state.index = state.history.length - 1
      reply({ frameId: "frame_1" })
      return changed(socket)
    }
    if (message.method === "Page.navigateToHistoryEntry") {
      state.index = message.params?.entryId ?? state.index
      reply({})
      return changed(socket)
    }
    if (message.method === "Page.reload") return reply({})
    socket.send(JSON.stringify({ id: message.id, error: { message: `Unknown method ${message.method}` } }))
  }
  const address = { port: 0 }
  const mcp = async (request: Request): Promise<Response> => {
    const body = Schema.decodeUnknownSync(Rpc)(await request.text())
    if (body.id === undefined) return new Response(null, { status: 202 })
    const reply = (result: unknown) =>
      Response.json({ jsonrpc: "2.0", id: body.id, result }, { headers: { "mcp-session-id": "kernel-test" } })
    if (body.method === "initialize")
      return reply({
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "kernel-test", version: "1" },
      })
    if (body.method === "tools/list")
      return reply({
        tools: [
          {
            name: "manage_browsers",
            description: "Create, list and delete cloud browsers.",
            inputSchema: {
              type: "object",
              properties: {
                action: { type: "string" },
                session_id: { type: "string" },
                kiosk_mode: { type: "boolean" },
              },
            },
          },
        ],
      })
    if (body.method === "tools/call") {
      const input = body.params?.arguments
      calls.push(input)
      if (typeof input === "object" && input !== null && "action" in input && input.action === "delete") {
        for (const socket of sockets) socket.close()
        return reply({ content: [{ type: "text", text: "browser session deleted successfully" }] })
      }
      state.created += 1
      const id = `browser_${state.created}`
      return reply({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              browser: {
                session_id: id,
                browser_live_view_url: `https://live.kernel.test/${id}`,
                cdp_ws_url: `ws://127.0.0.1:${address.port}/cdp/${id}`,
              },
            }),
          },
        ],
      })
    }
    return body.method === "ping"
      ? reply({})
      : Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Not supported" } })
  }
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        idleTimeout: 0,
        fetch: (request, served) => {
          if (new URL(request.url).pathname.startsWith("/cdp/"))
            return served.upgrade(request) ? undefined : new Response("Upgrade failed", { status: 400 })
          if (request.method === "GET") return new Response(null, { status: 405 })
          if (request.method === "DELETE") return new Response(null, { status: 200 })
          return mcp(request)
        },
        websocket: {
          open: (socket) => {
            state.opened += 1
            sockets.add(socket)
          },
          message: (socket, raw) => {
            answer(socket, String(raw))
          },
          close: (socket) => {
            sockets.delete(socket)
            Queue.offerUnsafe(closes, undefined)
          },
        },
      }),
    ),
    (served) => Effect.promise(() => served.stop(true)),
  )
  address.port = server.port ?? 0
  return {
    url: server.url.origin,
    calls,
    cdp: (id: string) => `ws://127.0.0.1:${address.port}/cdp/${id}`,
    opened: () => state.opened,
    open: () => sockets.size,
    closed: Queue.take(closes),
  }
})
