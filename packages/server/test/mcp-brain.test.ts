import { describe, expect } from "bun:test"
import { BunHttpServer } from "@effect/platform-bun"
import { Seed, testEffect } from "@ren/core/testing"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { HostMcp } from "@ren/host-api/host-mcp"
import { Brain } from "@ren/schema/brain"
import { Signature } from "@ren/schema/signature"
import { Space } from "@ren/schema/space"
import { Clock, Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpRouter } from "effect/http"
import { Routes } from "../src/routes.js"
import { environment, hostToken, services, sign } from "./lib/app.js"
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

const meta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
}

const send = Effect.fnUntraced(function* (
  headers: Record<string, string>,
  method: string,
  params: Record<string, unknown> = {},
) {
  const http = yield* HttpClient.HttpClient
  const response = yield* http.execute(
    HttpClientRequest.post("/mcp").pipe(
      HttpClientRequest.setHeaders({
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": method,
        ...(typeof params.name === "string" && { "mcp-name": params.name }),
        ...headers,
      }),
      HttpClientRequest.bodyJsonUnsafe({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: meta } }),
    ),
  )
  const text = yield* response.text
  return { status: response.status, text }
})

const tool = Effect.fnUntraced(function* (
  headers: Record<string, string>,
  name: string,
  args: Record<string, unknown> = {},
) {
  const answer = yield* send(headers, "tools/call", { name, arguments: args })
  expect(answer.status).toBe(200)
  return yield* Effect.promise(() => result(new Response(answer.text)))
})

const chat = Effect.fnUntraced(function* () {
  const database = yield* Database.Service
  yield* Seed.ren()
  const owner = yield* Seed.owner()
  const sessionId = yield* Seed.session(owner)
  const brainId = Brain.ofSession(sessionId)
  const join = Effect.fnUntraced(function* (role: string, options: { readonly inSpace: boolean }) {
    const joined = yield* Seed.actor(owner.organizationId, role)
    if (options.inSpace)
      yield* database.db
        .insert(Database.Schema.space_member)
        .values({ id: Space.MembershipID.create(), space_id: owner.spaceId, user_id: joined.userId })
    return joined.userId
  })
  const headers = Effect.fnUntraced(function* (
    input: { readonly userId?: string; readonly sessionId?: string; readonly token?: string } = {},
  ) {
    return {
      authorization: `Bearer ${input.token ?? (yield* hostToken(brainId, owner.organizationId))}`,
      [HostMcp.sessionHeader]: input.sessionId ?? sessionId,
      ...(input.userId && { [HostMcp.userHeader]: input.userId }),
    }
  })
  return { ...owner, sessionId, brainId, join, headers }
})

describe("Ren MCP for a brain", () => {
  it.live(
    "acts as the sender that a call names, or as the chat's creator when it names none, and records the agent and the chat on a task",
    () =>
      Effect.gen(function* () {
        const subject = yield* chat()
        const member = yield* subject.join("member", { inSpace: true })
        const headers = yield* subject.headers({ userId: member })
        expect(yield* tool(headers, "me_get")).toMatchObject({
          structuredContent: { user: { id: member }, organization: { id: subject.organizationId } },
        })
        expect(yield* tool(yield* subject.headers(), "me_get")).toMatchObject({
          structuredContent: { user: { id: subject.createdBy } },
        })
        expect(
          yield* tool(headers, "task_create", { spaceId: subject.spaceId, title: "Draft the launch plan" }),
        ).toMatchObject({
          isError: false,
          structuredContent: {
            createdBy: { userId: member, agentId: expect.any(String), sessionId: subject.sessionId },
          },
        })
      }),
  )

  it.live("channel_reply answers for the chat that calls it: a chat that no channel started has no thread", () =>
    Effect.gen(function* () {
      const subject = yield* chat()
      expect(yield* tool(yield* subject.headers(), "channel_reply", { text: "Rolled back." })).toMatchObject({
        isError: true,
        content: [{ type: "text", text: "InvalidRequestError: This chat has no thread to reply to." }],
      })
    }),
  )

  it.live("answers 401 to a sender that Ren refuses, a host token that it refuses and a call that names no chat", () =>
    Effect.gen(function* () {
      const subject = yield* chat()
      const outsider = yield* subject.join("member", { inSpace: false })
      const stranger = yield* Signature.generate("stranger")
      const now = Math.floor((yield* Clock.currentTimeMillis) / 1000)
      const forged = yield* sign(
        { scope: "host", brain: subject.brainId, gen: 1, org: subject.organizationId, iat: now, exp: now + 600 },
        stranger.privateKey,
      )
      const cases = [
        yield* subject.headers({ userId: outsider }),
        yield* subject.headers({ token: forged }),
        { authorization: (yield* subject.headers()).authorization },
      ]
      const answers = yield* Effect.forEach(cases, (headers) => send(headers, "tools/list"))
      expect(answers.map((answer) => answer.status)).toEqual([401, 401, 401])
    }),
  )

  it.live("accepts a brain's host token only through /mcp: the public API refuses it, even with the chat headers", () =>
    Effect.gen(function* () {
      const subject = yield* chat()
      const http = yield* HttpClient.HttpClient
      const response = yield* http.execute(
        HttpClientRequest.get("/me").pipe(
          HttpClientRequest.setHeaders(yield* subject.headers({ userId: subject.createdBy })),
        ),
      )
      expect(response.status).toBe(401)
    }),
  )
})
