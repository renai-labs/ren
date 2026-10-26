import { afterAll, describe, expect, test } from "bun:test"
import { Signature } from "@ren/schema/signature"
import { Effect, Option, Schema } from "effect"
import { authRequest, call, makeApp, sessionCookie, signUp } from "./lib/app.js"

const key = await Effect.runPromise(Signature.generate("ren-inference-test"))

const Claims = Schema.Struct({
  kid: Schema.String,
  exp: Schema.Number,
  org: Schema.String,
  sub: Schema.optional(Schema.String),
  member: Schema.optional(Schema.String),
  role: Schema.optional(Schema.String),
})

type Seen = { method: string; path: string; claims: typeof Claims.Type; body: unknown }

const seen: Seen[] = []
let removals: Array<() => Response> = []
let connectedBy: string | null = null

const connection = () => ({
  id: "conn_1",
  label: "Team plan",
  providerName: "Provider",
  iconUrl: "https://inference.test/icon.svg",
  status: { label: "Active", tone: "ok" },
  canReconnect: true,
  connectedBy,
  meters: [],
})
let removed = Promise.withResolvers<void>()

const replies = new Map<string, () => Response>([
  ["POST /v1/connect", () => Response.json({ url: "https://inference.test/connect?t=one-time" })],
  ["GET /v1/connections", () => Response.json([connection()])],
  ["PATCH /v1/connections/conn_1", () => Response.json(connection())],
  ["DELETE /v1/connections/conn_1", () => new Response(null, { status: 204 })],
])

const service = Bun.serve({
  port: 0,
  fetch: async (request) => {
    const token = request.headers.get("authorization")?.replace(/^Bearer /u, "") ?? ""
    const claims = await Effect.runPromise(Signature.verify([key.publicKey], Claims, token))
    if (Option.isNone(claims)) return new Response(null, { status: 401 })
    const path = new URL(request.url).pathname
    const body: unknown = request.method === "POST" || request.method === "PATCH" ? await request.json() : null
    seen.push({ method: request.method, path, claims: claims.value, body })
    const reply = replies.get(`${request.method} ${path}`)
    if (reply) return reply()
    if (path.startsWith("/v1/members/")) {
      const reply = removals.shift()?.() ?? new Response(null, { status: 204 })
      if (reply.status === 204) removed.resolve()
      return reply
    }
    return new Response(null, { status: 404 })
  },
})

const app = makeApp(undefined, {
  config: {
    REN_INFERENCE_URL: `http://127.0.0.1:${service.port}`,
    REN_INFERENCE_KEYS: JSON.stringify([
      { id: key.privateKey.id, key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(key.privateKey.key) },
    ]),
  },
})

afterAll(async () => {
  await app.dispose()
  await service.stop()
})

describe("ren-inference", () => {
  test("the connect route returns the service's url and never reads a code", async () => {
    const owner = sessionCookie(await signUp(app, "connect@gmail.com", "Owner"))
    seen.length = 0

    const response = await call(app, owner, "POST", "/ren-inference/connect", {
      returnUrl: "http://localhost:5173/app/settings/providers",
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ url: "https://inference.test/connect?t=one-time" })
    expect(seen).toEqual([
      {
        method: "POST",
        path: "/v1/connect",
        body: { returnUrl: "http://localhost:5173/app/settings/providers" },
        claims: expect.objectContaining({
          org: expect.stringMatching(/^org_/),
          sub: expect.stringMatching(/^usr_/),
          member: expect.stringMatching(/^mem_/),
        }),
      },
    ])
    expect(seen.at(0)?.claims.role).toBeUndefined()
  })

  test("removing a member asks the service to forget them, and a 503 does not block the removal", async () => {
    const owner = sessionCookie(await signUp(app, "lead@gmail.com", "Lead"))
    const joiner = sessionCookie(await signUp(app, "leaver@gmail.com", "Leaver"))
    const team = await (
      await app.handler(authRequest("/organization/create", { name: "Crew", slug: "crew" }, owner))
    ).json()
    const invitation = await (
      await app.handler(
        authRequest(
          "/organization/invite-member",
          { email: "leaver@gmail.com", role: "member", organizationId: team.id },
          owner,
        ),
      )
    ).json()
    await app.handler(authRequest("/organization/accept-invitation", { invitationId: invitation.id }, joiner))
    removals = [() => new Response("down", { status: 503 })]
    removed = Promise.withResolvers<void>()
    seen.length = 0

    const removal = await app.handler(
      authRequest(
        "/organization/remove-member",
        { memberIdOrEmail: "leaver@gmail.com", organizationId: team.id },
        owner,
      ),
    )

    expect(removal.status).toBe(200)
    const memberId = (await removal.json()).member.id
    expect(memberId).toMatch(/^mem_/)
    await removed.promise
    expect(seen.map((entry) => [entry.method, entry.path, entry.claims.org])).toEqual([
      ["DELETE", `/v1/members/${memberId}`, team.id],
      ["DELETE", `/v1/members/${memberId}`, team.id],
    ])
  })

  test("Ren decides who manages a connection: the member who connected it and admins, never another member", async () => {
    const owner = sessionCookie(await signUp(app, "manager@gmail.com", "Manager"))
    const adaSignUp = await signUp(app, "ada-connects@gmail.com", "Ada")
    const ada = sessionCookie(adaSignUp)
    const grace = sessionCookie(await signUp(app, "grace-watches@gmail.com", "Grace"))
    const team = await (
      await app.handler(authRequest("/organization/create", { name: "Models", slug: "models" }, owner))
    ).json()
    for (const [email, cookie] of [
      ["ada-connects@gmail.com", ada],
      ["grace-watches@gmail.com", grace],
    ] as const) {
      const invitation = await (
        await app.handler(
          authRequest("/organization/invite-member", { email, role: "member", organizationId: team.id }, owner),
        )
      ).json()
      await app.handler(authRequest("/organization/accept-invitation", { invitationId: invitation.id }, cookie))
    }
    connectedBy = (await adaSignUp.clone().json()).user.id
    const canManage = async (cookie: string) =>
      (await (await call(app, cookie, "GET", "/ren-inference/connections")).json()).map(
        (each: { canManage: boolean }) => each.canManage,
      )

    expect([await canManage(owner), await canManage(ada), await canManage(grace)]).toEqual([[true], [true], [false]])
    seen.length = 0
    expect((await call(app, grace, "PATCH", "/ren-inference/connections/conn_1", { label: "Mine" })).status).toBe(403)
    expect((await call(app, grace, "DELETE", "/ren-inference/connections/conn_1")).status).toBe(403)
    expect(
      (
        await call(app, grace, "POST", "/ren-inference/connect", {
          returnUrl: "http://localhost:5173/app/settings/providers",
          connectionId: "conn_1",
        })
      ).status,
    ).toBe(403)
    expect(seen.filter((entry) => entry.path !== "/v1/connections")).toEqual([])
    expect((await call(app, ada, "PATCH", "/ren-inference/connections/conn_1", { label: "Ada’s" })).status).toBe(200)
    expect((await call(app, owner, "DELETE", "/ren-inference/connections/conn_1")).status).toBe(204)
  })
})
