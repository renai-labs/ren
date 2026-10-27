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

  it.live(
    "schedule_create with this-chat sets a follow-up for the chat that calls it, owned by its sender (schedules S20)",
    () =>
      Effect.gen(function* () {
        const subject = yield* chat()
        expect(
          yield* tool(yield* subject.headers(), "schedule_create", {
            spaceId: subject.spaceId,
            name: "CI check",
            message: "Check CI again.",
            when: { in: "30 minutes" },
            target: "this-chat",
          }),
        ).toMatchObject({
          isError: false,
          structuredContent: { target: { sessionId: subject.sessionId }, ownerId: subject.createdBy, status: "active" },
        })
      }),
  )

  it.live(
    "an agent keeps its space’s memory through the memory tools, and only reads the organization’s (memory M5)",
    () =>
      Effect.gen(function* () {
        const subject = yield* chat()
        const headers = yield* subject.headers()
        const file = { spaceId: subject.spaceId, path: "people/Ana notes", content: "- Prefers short replies." }
        expect(yield* tool(headers, "memory_write", file)).toMatchObject({
          isError: false,
          content: [{ type: "text", text: "" }],
        })
        expect(yield* tool(headers, "memory_list", { spaceId: subject.spaceId, prefix: "people/" })).toMatchObject({
          isError: false,
          content: [{ type: "text", text: JSON.stringify([file.path]) }],
        })
        expect(
          yield* tool(headers, "memory_edit", {
            spaceId: subject.spaceId,
            path: file.path,
            oldString: "short",
            newString: "long",
          }),
        ).toMatchObject({ isError: false })
        expect(yield* tool(headers, "memory_read", { spaceId: subject.spaceId, path: file.path })).toMatchObject({
          structuredContent: { content: "- Prefers long replies." },
        })
        expect(yield* tool(headers, "memory_delete", { spaceId: subject.spaceId, path: file.path })).toMatchObject({
          isError: false,
          content: [{ type: "text", text: "" }],
        })
        expect(
          yield* tool(headers, "memory_write", { path: "memory.md", content: "- Ship on Fridays." }),
        ).toMatchObject({
          isError: true,
          content: [{ text: expect.stringContaining("ForbiddenError") }],
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
