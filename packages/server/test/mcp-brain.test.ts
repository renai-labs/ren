import { describe, expect } from "bun:test"
import { BunHttpServer } from "@effect/platform-bun"
import { Seed, testEffect } from "@ren/core/testing"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { HostMcp } from "@ren/host-api/host-mcp"
import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Signature } from "@ren/schema/signature"
import { Space } from "@ren/schema/space"
import { eq } from "drizzle-orm"
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
  it.live("acts as the sender of the turn, and a task it creates records the sender, the agent and the chat", () =>
    Effect.gen(function* () {
      const subject = yield* chat()
      const member = yield* subject.join("member", { inSpace: true })
      const headers = yield* subject.headers({ userId: member })
      expect(yield* tool(headers, "me_get")).toMatchObject({
        isError: false,
        structuredContent: { user: { id: member }, organization: { id: subject.organizationId } },
      })
      expect(
        yield* tool(headers, "task_create", { spaceId: subject.spaceId, title: "Draft the launch plan" }),
      ).toMatchObject({
        isError: false,
        structuredContent: {
          spaceId: subject.spaceId,
          createdBy: { userId: member, agentId: expect.any(String), sessionId: subject.sessionId },
        },
      })
    }),
  )

  it.live("acts as the sender that each call names, and as the chat's creator when a call names none", () =>
    Effect.gen(function* () {
      const subject = yield* chat()
      const member = yield* subject.join("member", { inSpace: true })
      const me = Effect.fnUntraced(function* (userId?: string) {
        const answer = yield* tool(yield* subject.headers(userId ? { userId } : {}), "me_get")
        return answer.structuredContent
      })
      expect(yield* me(member)).toMatchObject({ user: { id: member } })
      expect(yield* me(subject.createdBy)).toMatchObject({ user: { id: subject.createdBy } })
      expect(yield* me()).toMatchObject({ user: { id: subject.createdBy } })
    }),
  )

  it.live(
    "answers 401 to a sender who cannot see the chat or left the organization, a chat that is not on the brain or is archived, and a host token that is retired, expired, forged or of another organization",
    () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const subject = yield* chat()
        const outsider = yield* subject.join("member", { inSpace: false })
        const leaver = yield* subject.join("member", { inSpace: true })
        yield* database.db.delete(Database.Schema.member).where(eq(Database.Schema.member.userId, leaver))
        const other = yield* chat()
        const archived = yield* Seed.session(subject)
        yield* database.db
          .update(Database.Schema.agent_session)
          .set({ archived_at: new Date() })
          .where(eq(Database.Schema.agent_session.id, archived))
        const now = Math.floor((yield* Clock.currentTimeMillis) / 1000)
        const stranger = yield* Signature.generate("stranger")
        const cases = [
          yield* subject.headers({ userId: outsider }),
          yield* subject.headers({ userId: leaver }),
          yield* subject.headers({ sessionId: other.sessionId }),
          yield* subject.headers({
            sessionId: archived,
            token: yield* hostToken(Brain.ofSession(archived), subject.organizationId),
          }),
          yield* subject.headers({
            token: yield* hostToken(subject.brainId, subject.organizationId, { exp: now - 120 }),
          }),
          yield* subject.headers({
            token: yield* sign(
              { scope: "host", brain: subject.brainId, gen: 1, org: subject.organizationId, iat: now, exp: now + 600 },
              stranger.privateKey,
            ),
          }),
          yield* subject.headers({ token: yield* hostToken(subject.brainId, Auth.OrganizationID.create()) }),
          { authorization: (yield* subject.headers()).authorization },
        ]
        const statuses = yield* Effect.forEach(cases, (headers) => send(headers, "tools/list"))
        expect(statuses.map((answer) => answer.status)).toEqual(cases.map(() => 401))
        yield* database.db
          .update(Database.Schema.brain)
          .set({ generation: 2 })
          .where(eq(Database.Schema.brain.id, subject.brainId))
        expect((yield* send(yield* subject.headers(), "tools/list")).status).toBe(401)
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

  it.live("keeps a brain's calls in the chat's space and within the agent rules, even for an admin sender", () =>
    Effect.gen(function* () {
      const subject = yield* chat()
      const elsewhere = yield* Seed.space(subject.organizationId)
      const headers = yield* subject.headers({ userId: subject.createdBy })
      const refused = {
        isError: true,
        content: [{ type: "text", text: expect.stringMatching(/^(NotFound|Forbidden)Error: /) }],
      }
      expect(yield* tool(headers, "space_get", { idOrSlug: subject.spaceId })).toMatchObject({ isError: false })
      expect(yield* tool(headers, "space_get", { idOrSlug: elsewhere })).toMatchObject(refused)
      expect(yield* tool(headers, "task_create", { spaceId: elsewhere, title: "Elsewhere" })).toMatchObject(refused)
      expect(yield* tool(headers, "space_update", { id: subject.spaceId, name: "Renamed" })).toMatchObject(refused)
    }),
  )

  it.live("lists every Ren tool to a brain", () =>
    Effect.gen(function* () {
      const subject = yield* chat()
      const listed = yield* send(yield* subject.headers({ userId: subject.createdBy }), "tools/list")
      expect((yield* Effect.promise(() => result(new Response(listed.text)))).tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "task_create" }),
          expect.objectContaining({ name: "space_update" }),
        ]),
      )
    }),
  )
})
