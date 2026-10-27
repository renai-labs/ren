import { describe, expect } from "bun:test"
import { BunHttpServer } from "@effect/platform-bun"
import { Seed, testEffect } from "@ren/core/testing"
import { Testing } from "@ren/db/testing"
import { HostMcp } from "@ren/host-api/host-mcp"
import { Brain } from "@ren/schema/brain"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpRouter } from "effect/http"
import { Routes } from "../src/routes.js"
import { SlackMcp } from "../src/slack-mcp.js"
import { environment, hostToken, services } from "./lib/app.js"
import { result } from "./lib/mcp.js"

const it = testEffect(
  HttpRouter.serve(Routes.layer, { disableListenLog: true, disableLogger: true }).pipe(
    Layer.provide(services),
    Layer.provide(FetchHttpClient.layer),
    Layer.provideMerge(BunHttpServer.layerTest),
    Layer.provideMerge(Testing.layer),
    Layer.provide(environment()),
  ),
)

const send = Effect.fnUntraced(function* (
  headers: Record<string, string>,
  method: string,
  params: Record<string, unknown> = {},
) {
  const http = yield* HttpClient.HttpClient
  const response = yield* http.execute(
    HttpClientRequest.post(SlackMcp.path).pipe(
      HttpClientRequest.setHeaders({
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": method,
        ...(typeof params.name === "string" && { "mcp-name": params.name }),
        ...headers,
      }),
      HttpClientRequest.bodyJsonUnsafe({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    ),
  )
  return { status: response.status, text: yield* response.text }
})

describe("Slack MCP", () => {
  it.live(
    "serves the Slack tools to a brain's chat only, and a call where Slack is off is a tool error with the reason",
    () =>
      Effect.gen(function* () {
        yield* Seed.ren()
        const owner = yield* Seed.owner()
        const sessionId = yield* Seed.session(owner)
        const headers = {
          authorization: `Bearer ${yield* hostToken(Brain.ofSession(sessionId), owner.organizationId)}`,
          [HostMcp.sessionHeader]: sessionId,
        }
        expect((yield* send({ authorization: headers.authorization }, "tools/list")).status).toBe(401)
        const listed = yield* send(headers, "tools/list")
        expect(listed.status).toBe(200)
        expect(listed.text).toContain('"name":"reply_to_current_thread"')
        const called = yield* send(headers, "tools/call", { name: "list_channels", arguments: {} })
        expect(yield* Effect.promise(() => result(new Response(called.text)))).toMatchObject({
          isError: true,
          content: [{ type: "text", text: "Slack is not set up on this Ren server." }],
        })
      }),
  )
})
