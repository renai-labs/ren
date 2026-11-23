export * as StandInInference from "./inference.js"

import { RenInference } from "@ren/schema/ren-inference"
import { Option, Schema } from "effect"

const Claims = Schema.Struct({
  org: Schema.String,
  member: Schema.optional(Schema.String),
})
const decodeClaims = Schema.decodeUnknownOption(Schema.fromJsonString(Claims))
const decodeCreate = Schema.decodeUnknownSync(RenInference.CreateKeyInput)
const decodeRevision = Schema.decodeUnknownOption(Schema.Struct({ revision: Schema.String }))
const decodeKey = Schema.decodeUnknownOption(Schema.Struct({ fields: Schema.Record(Schema.String, Schema.String) }))

// oxlint-disable-next-line ren/no-comments -- The stand-in vendor refuses any key that does not start with "sk-good".
const keyOk = (body: unknown) => Option.getOrUndefined(decodeKey(body))?.fields.apiKey?.startsWith("sk-good") ?? false

const expiryDays: Readonly<Record<RenInference.Expiry, number | null>> = {
  "7d": 7,
  "30d": 30,
  "1y": 365,
  never: null,
}

interface Key {
  readonly id: string
  readonly org: string
  readonly name: string
  readonly prefix: string
  readonly secret: string
  status: RenInference.KeyStatus
  readonly ownerMemberId: string
  readonly expiresAt: string | null
  readonly createdAt: string
}

const present = (key: Key) => ({
  id: key.id,
  name: key.name,
  prefix: key.prefix,
  status: key.status,
  ownerMemberId: key.ownerMemberId,
  expiresAt: key.expiresAt,
  createdAt: key.createdAt,
})

interface Request {
  readonly request: globalThis.Request
  readonly claims: typeof Claims.Type | undefined
  readonly found: Key | undefined
}

// oxlint-disable-next-line ren/no-comments -- A stand-in for the Ren Inference Service: inference keys in memory, no connections, and the model catalog and brain keys of the stub model at `stub`.
export const start = (stub: string, ren: { readonly url: string; readonly usageKey: string }) => {
  const keys: Key[] = []
  const seats: Array<{ readonly id: string; readonly org: string; readonly label: string }> = []
  const freeUsed = new Map<string, number>()
  const tellRen = (org: string) =>
    fetch(`${ren.url}/internal/inference/changed`, {
      method: "POST",
      headers: { authorization: `Bearer ${ren.usageKey}`, "content-type": "application/json" },
      body: JSON.stringify({ organizationId: org }),
    })
  const baseUrl = stub
  const notFound = () => Response.json({ error: "not found" }, { status: 404 })
  const routes: Readonly<Record<string, (input: Request) => Response | Promise<Response>>> = {
    "GET /v1/connections": (input) =>
      Response.json(
        seats
          .filter((seat) => seat.org === input.claims?.org)
          .map((seat) => ({
            id: seat.id,
            label: seat.label,
            providerName: "Anthropic",
            providerId: "anthropic",
            iconUrl: "",
            status: { label: "Active", tone: "ok" },
            plan: "Max",
            models: ["stub-model"],
            canReconnect: false,
            meters: [],
            connectedBy: null,
          })),
      ),
    // oxlint-disable-next-line ren/no-comments -- The sign-in page is this stand-in's: opening it connects a seat for the organization and tells Ren, as the gateway does.
    "POST /v1/connect": (input) =>
      Response.json({ url: `${server.url.origin}/signin?org=${encodeURIComponent(input.claims?.org ?? "")}` }),
    "GET /signin": async (input) => {
      const org = new URL(input.request.url).searchParams.get("org") ?? ""
      seats.push({ id: `seat_stub_${seats.length}`, org, label: "Claude subscription" })
      await tellRen(org)
      return new Response("Signed in. You can close this tab.")
    },
    "PUT /v1/providers/:id": () => new Response(null, { status: 204 }),
    "POST /v1/providers/:id/test": async (input) =>
      Response.json(keyOk(await input.request.json()) ? { ok: true } : { ok: false, message: "Invalid API key." }),
    "PUT /v1/providers/:id/key": async (input) => {
      const body: unknown = await input.request.json()
      if (!keyOk(body)) return Response.json({ error: "Invalid API key." }, { status: 400 })
      const key = Option.getOrUndefined(decodeKey(body))?.fields.apiKey ?? ""
      return Response.json({ last4: key.slice(-4), testedAt: new Date().toISOString() })
    },
    "DELETE /v1/providers/:id/key": () => new Response(null, { status: 204 }),
    "GET /v1/usage/free": (input) =>
      Response.json({
        used: freeUsed.get(input.claims?.org ?? "") ?? 41,
        limit: 100,
        resetsAt: new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString(),
      }),
    "POST /v1/keys": () => Response.json({ key: "stub-key" }),
    "PUT /v1/ren-models": async (input) => {
      const body: unknown = await input.request.json()
      return Response.json({
        revision: Option.getOrUndefined(decodeRevision(body))?.revision ?? "",
        models: 0,
      })
    },
    "GET /v1/inference-keys": (input) =>
      Response.json({
        baseUrl,
        keys: keys
          .filter((key) => key.org === input.claims?.org)
          .map(present)
          .toReversed(),
      }),
    "POST /v1/inference-keys": async (input) => {
      const created = decodeCreate(await input.request.json())
      const days = expiryDays[created.expiresIn]
      const secret = `sk-ren-${crypto.randomUUID().replaceAll("-", "")}`
      const key: Key = {
        id: `ifk_${crypto.randomUUID().replaceAll("-", "").slice(0, 26)}`,
        org: input.claims?.org ?? "",
        name: created.name,
        prefix: secret.slice(0, 12),
        secret,
        status: "active",
        ownerMemberId: input.claims?.member ?? "",
        expiresAt: days === null ? null : new Date(Date.now() + days * 86_400_000).toISOString(),
        createdAt: new Date().toISOString(),
      }
      keys.push(key)
      return Response.json({ ...present(key), secret, baseUrl })
    },
    "DELETE /v1/inference-keys/:id": (input) => {
      if (!input.found) return notFound()
      input.found.status = "revoked"
      return new Response(null, { status: 204 })
    },
    "GET /v1/inference-keys/:id/secret": (input) => {
      if (!input.found) return notFound()
      return input.found.ownerMemberId === input.claims?.member
        ? Response.json({ secret: input.found.secret, baseUrl })
        : Response.json({ error: "only the owner reads the secret of a key" }, { status: 403 })
    },
  }
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (request) => {
      const url = new URL(request.url)
      const token = request.headers.get("authorization")?.split(".")[1] ?? ""
      const claims = Option.getOrUndefined(decodeClaims(Buffer.from(token, "base64url").toString()))
      const found = keys.find((key) => url.pathname.includes(key.id) && key.org === claims?.org)
      const path = url.pathname.replace(/ifk_\w+/u, ":id").replace(/^\/v1\/providers\/[^/]+/u, "/v1/providers/:id")
      const route = routes[`${request.method} ${path}`]
      if (route) return route({ request, claims, found })
      if (request.method === "DELETE") return new Response(null, { status: 204 })
      return fetch(new URL(`${url.pathname}${url.search}`, stub), {
        headers: request.headers,
      })
    },
  })
  return {
    url: `http://127.0.0.1:${server.port}`,
    // oxlint-disable-next-line ren/no-comments -- A test sets an organization's free requests of today, as the gateway counts them.
    setFreeUsed: (org: string, used: number) => void freeUsed.set(org, used),
    stop: () => server.stop(true),
  }
}
