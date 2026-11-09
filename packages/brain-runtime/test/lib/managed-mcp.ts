export * as ManagedMcp from "./managed-mcp.js"

import { Context, Effect, Layer } from "effect"
import { McpProtocol, McpSchema, McpServer } from "effect/ai"
import { HttpRouter, HttpServer } from "effect/http"

export const make = Effect.fnUntraced(function* (tools: ReadonlyArray<string> = []) {
  const headers: Array<Headers> = []
  const paths: Array<string> = []
  const calls: Array<string> = []
  const start = (label: string) =>
    HttpRouter.toWebHandler(
      Layer.effectDiscard(
        Effect.gen(function* () {
          const server = yield* McpServer.McpServer
          yield* Effect.forEach(["marker", ...tools], (name) =>
            server.addTool({
              tool: new McpSchema.Tool({ name, inputSchema: { type: "object", properties: {} } }),
              annotations: Context.empty(),
              handle: () => {
                calls.push(name)
                return Effect.succeed(new McpSchema.CallToolResult({ content: [{ type: "text", text: label }] }))
              },
            }),
          )
        }),
      ).pipe(
        Layer.provideMerge(
          McpServer.layerHttp({
            name: "ren-test",
            version: "1",
            path: "/mcp",
            protocols: [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25, McpProtocol.v2025_06_18],
          }),
        ),
        Layer.provide(HttpServer.layerServices),
      ),
      { disableLogger: true },
    )
  let api = start("first")
  yield* Effect.addFinalizer(() => Effect.promise(() => api.dispose()))
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        idleTimeout: 0,
        fetch: (request) => {
          headers.push(request.headers)
          paths.push(new URL(request.url).pathname)
          const url = new URL(request.url)
          url.pathname = "/mcp"
          return api.handler(new Request(url.href, request))
        },
      }),
    ),
    (server) => Effect.promise(() => server.stop(true)),
  )
  return {
    url: server.url.origin,
    headers,
    paths,
    calls,
    restart: Effect.promise(async () => {
      await api.dispose()
      api = start("restarted")
    }),
  }
})
