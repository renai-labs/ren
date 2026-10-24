export * as McpPeer from "./mcp.js"

import { App } from "@ren/schema/app"
import type { AppCatalog } from "@ren/schema/app-catalog"
import { AppRelease } from "@ren/schema/app-release"
import { Deferred, Effect, Queue, Schema } from "effect"
import { Shared } from "./shared.js"

type Declaration = AppCatalog.McpEntry["declaration"]

export const catalog = (
  fingerprint: string,
  mcps: ReadonlyArray<
    ({ readonly url: string } | { readonly transport: Declaration["transport"] }) & {
      readonly slug: string
      readonly auth?: Declaration["auth"]
      readonly timeouts?: Declaration["timeouts"]
    }
  >,
): AppCatalog.Info => ({
  fingerprint,
  catalog: {
    apps: [],
    skills: [],
    credentials: [],
    mcps: mcps.map((mcp) => ({
      appId: App.ID.create(),
      releaseId: AppRelease.ID.create(),
      appSlug: "docs",
      version: "1.0.0",
      slug: mcp.slug,
      declaration: {
        name: "Docs",
        description: "Docs",
        transport: "transport" in mcp ? mcp.transport : { type: "remote", url: mcp.url },
        auth: mcp.auth ?? { type: "none" },
        ...(mcp.timeouts && { timeouts: mcp.timeouts }),
        requiredCredentials:
          mcp.auth?.type === "header" ? [{ kind: "secret", name: mcp.auth.credential, optional: false }] : [],
      },
    })),
  },
})

export const execute = (path: string) =>
  Shared.stub().script({ tools: [{ name: "execute", input: { code: `return await tools.${path}()` } }] })

export const result = (script: ReturnType<typeof execute>) =>
  script.calls.at(-1)?.body.messages.findLast((message) => message.role === "tool")?.content

const RequestBody = Schema.Struct({
  id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number])),
  method: Schema.String,
  params: Schema.optionalKey(
    Schema.Struct({ cursor: Schema.optionalKey(Schema.String), name: Schema.optionalKey(Schema.String) }),
  ),
})

export const make = Effect.fnUntraced(function* (
  options: { readonly hold?: boolean; readonly holdInitialization?: boolean } = {},
) {
  const requests = yield* Queue.unbounded<typeof RequestBody.Type>()
  const listening = yield* Deferred.make<void>()
  const streams = new Map<Request, ReadableStreamDefaultController<Uint8Array>>()
  const encoder = new TextEncoder()
  const state = { label: "first" }
  const release = Promise.withResolvers<void>()
  const initialized = options.holdInitialization ? release.promise : Promise.resolve()
  const called = options.hold ? release.promise : Promise.resolve()
  yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        idleTimeout: 0,
        fetch: async (request) => {
          if (request.method === "DELETE") return new Response(null, { status: 200 })
          if (request.method === "GET")
            return new Response(
              new ReadableStream<Uint8Array>({
                start: (controller) => {
                  streams.set(request, controller)
                  controller.enqueue(encoder.encode(": connected\n\n"))
                  Deferred.doneUnsafe(listening, Effect.void)
                },
                cancel: () => {
                  streams.delete(request)
                },
              }),
              { headers: { "content-type": "text/event-stream" } },
            )
          const body = Schema.decodeUnknownSync(RequestBody)(await request.json())
          Queue.offerUnsafe(requests, body)
          if (body.id === undefined) return new Response(null, { status: 202 })
          const reply = (result: unknown) =>
            Response.json(
              { jsonrpc: "2.0", id: body.id, result },
              { headers: { "mcp-session-id": request.headers.get("mcp-session-id") ?? crypto.randomUUID() } },
            )
          if (body.method === "initialize") {
            await initialized
            return reply({
              protocolVersion: "2025-03-26",
              capabilities: { tools: { listChanged: true } },
              serverInfo: { name: "ren-test", version: "1" },
              instructions: "Use the test tools to read the marker.",
            })
          }
          if (body.method === "tools/list")
            return reply({
              tools: [
                {
                  name: body.params?.cursor ? "second" : "marker",
                  description: state.label,
                  inputSchema: { type: "object", properties: {} },
                  annotations: { readOnlyHint: true },
                },
              ],
              ...(body.params?.cursor ? {} : { nextCursor: "page-two" }),
            })
          if (body.method === "tools/call") {
            await called
            return reply({ content: [{ type: "text", text: state.label }] })
          }
          if (body.method === "ping") return reply({})
          return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Not supported" } })
        },
      }),
    ),
    (server) => Effect.promise(() => server.stop(true)),
  )
  return {
    url: server.url.origin,
    requests,
    listening: Deferred.await(listening),
    release: () => release.resolve(),
    change: (label: string) =>
      Effect.sync(() => {
        state.label = label
        for (const stream of streams.values())
          stream.enqueue(
            encoder.encode(
              `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" })}\n\n`,
            ),
          )
      }),
  }
})
