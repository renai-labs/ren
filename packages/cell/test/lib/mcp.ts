export * as McpPeer from "./mcp.js"

import { App } from "@ren/schema/app"
import type { AppCatalog } from "@ren/schema/app-catalog"
import { AppProfile } from "@ren/schema/app-profile"
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
      readonly profile?: { readonly slug: string; readonly name: string }
      readonly appSlug?: string
      readonly env?: Readonly<Record<string, string>>
    }
  >,
  extra: Partial<Pick<AppCatalog.Catalog, "apps" | "unavailable">> = {},
): AppCatalog.Info => ({
  fingerprint,
  catalog: {
    apps: extra.apps ?? [],
    skills: [],
    unavailable: extra.unavailable ?? [],
    mcps: mcps.map((mcp) => ({
      appId: App.ID.create(),
      appSlug: mcp.appSlug ?? "docs",
      slug: mcp.slug,
      server: mcp.profile ? `${mcp.slug}__${mcp.profile.slug}` : mcp.slug,
      profile: mcp.profile
        ? { id: AppProfile.ID.create(), slug: mcp.profile.slug, name: mcp.profile.name, kind: "shared" }
        : null,
      label: mcp.profile
        ? `MCP_${mcp.slug.toUpperCase().replaceAll("-", "_")}__${mcp.profile.slug.toUpperCase().replaceAll("-", "_")}`
        : null,
      ...(mcp.env && { env: mcp.env }),
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
  options: {
    readonly hold?: boolean
    readonly holdInitialization?: boolean
    readonly tools?: ReadonlyArray<string>
  } = {},
) {
  const requests = yield* Queue.unbounded<typeof RequestBody.Type>()
  const listening = yield* Deferred.make<void>()
  const streams = new Map<Request, ReadableStreamDefaultController<Uint8Array>>()
  const encoder = new TextEncoder()
  const state = { label: "first", status: 200 }
  const headers: Array<Headers> = []
  const calls: Array<string> = []
  const release = Promise.withResolvers<void>()
  const initialized = options.holdInitialization ? release.promise : Promise.resolve()
  const called = options.hold ? release.promise : Promise.resolve()
  yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
  const stream = (request: Request) =>
    new Response(
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
  const answer = async (body: typeof RequestBody.Type, reply: (result: unknown) => Response) => {
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
        tools: (body.params?.cursor ? ["second", ...(options.tools ?? [])] : ["marker"]).map((name) => ({
          name,
          description: state.label,
          inputSchema: { type: "object", properties: {} },
          annotations: { readOnlyHint: true },
        })),
        ...(body.params?.cursor ? {} : { nextCursor: "page-two" }),
      })
    if (body.method === "tools/call") {
      calls.push(body.params?.name ?? "")
      await called
      return reply({ content: [{ type: "text", text: state.label }] })
    }
    return body.method === "ping"
      ? reply({})
      : Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Not supported" } })
  }
  const refused = () =>
    Response.json(
      { error: "credential_reconnect" },
      { status: state.status, headers: { "x-ren-deny": "credential_reconnect" } },
    )
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        idleTimeout: 0,
        fetch: async (request) => {
          if (state.status !== 200) return refused()
          if (request.method === "DELETE") return new Response(null, { status: 200 })
          if (request.method === "GET") return stream(request)
          headers.push(request.headers)
          const body = Schema.decodeUnknownSync(RequestBody)(await request.json())
          Queue.offerUnsafe(requests, body)
          if (body.id === undefined) return new Response(null, { status: 202 })
          const reply = (result: unknown) =>
            Response.json(
              { jsonrpc: "2.0", id: body.id, result },
              { headers: { "mcp-session-id": request.headers.get("mcp-session-id") ?? crypto.randomUUID() } },
            )
          return answer(body, reply)
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
    headers,
    calls,
    refuse: (status: number) =>
      Effect.sync(() => {
        state.status = status
      }),
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
