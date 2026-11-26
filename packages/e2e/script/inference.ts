export * as StandInInference from "./inference.js"

import type { Models } from "@ren/schema/models"
import { RenInference } from "@ren/schema/ren-inference"
import { Option, Schema, Struct } from "effect"

const Claims = Schema.Struct({
  org: Schema.String,
  member: Schema.optional(Schema.String),
})
const decodeClaims = Schema.decodeUnknownOption(Schema.fromJsonString(Claims))
const decodeCreate = Schema.decodeUnknownSync(RenInference.CreateKeyInput)
const decodeKey = Schema.decodeUnknownOption(Schema.Struct({ fields: Schema.Record(Schema.String, Schema.String) }))

// oxlint-disable-next-line ren/no-comments -- The stand-in vendor takes only a key that starts with "sk-good".
const keyOf = (body: unknown) => Option.getOrUndefined(decodeKey(body))?.fields.apiKey ?? ""
const decodeChange = Schema.decodeUnknownSync(
  Schema.Struct({
    enabled: Schema.optionalKey(Schema.Boolean),
    method: Schema.optionalKey(Schema.Literals(["key", "subscription"])),
  }),
)
const decodeSwitches = Schema.decodeUnknownSync(
  Schema.Struct({ models: Schema.Array(Schema.Struct({ id: Schema.String, enabled: Schema.Boolean })) }),
)
const decodeCode = Schema.decodeUnknownSync(Schema.Struct({ code: Schema.String }))

// oxlint-disable-next-line ren/no-comments -- The stand-in Claude: a key serves its API models; a member's Max seat serves two of them. The code "good-code" signs in.
const anthropicKeyModels = [
  {
    id: "claude-opus-5-5",
    type: "chat",
    name: "Claude Opus 5.5",
    protocol: "anthropic-messages",
    gateway: "anthropic/claude-opus-5-5",
  },
  {
    id: "claude-haiku-5-5",
    type: "chat",
    name: "Claude Haiku 5.5",
    protocol: "anthropic-messages",
    gateway: "anthropic/claude-haiku-5-5",
  },
]
const anthropicSeatModels = anthropicKeyModels.map((model, index) =>
  Struct.assign(model, {
    gateway: `seat/anthropic/${model.id}`,
    plans: ["Max"],
    rank: index + 1,
    ...(index === 0 && { featured: true }),
  }),
)

interface ProviderSettings {
  readonly enabled: boolean
  readonly method?: "key" | "subscription"
  readonly off: ReadonlyArray<string>
  readonly key?: { readonly last4: string; readonly testedAt: string; readonly savedBy?: string }
}

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
  readonly provider: string
}

// oxlint-disable-next-line ren/no-comments -- A model of the Ren provider: its gateway name and price, unless the test gave its own.
const asRenModel = (model: Models.Info): Models.Info =>
  Struct.assign({ gateway: `ren/${model.id}`, price: { input: 1, output: 2 } }, model)

// oxlint-disable-next-line ren/no-comments -- A free Ren model: price 0, and the inference service counts its requests against the free cap.
const freeModel: Models.Info = {
  id: "stub/stub-free",
  type: "chat",
  protocol: "openai-chat",
  name: "Stub Free",
  limit: { context: 100_000, output: 4000 },
  gateway: "ren/stub/stub-free",
  price: { input: 0, output: 0 },
  free: true,
}

// oxlint-disable-next-line ren/no-comments -- An own-key provider: Groq, with one model.
const groq = [{ id: "llama-5", type: "chat", name: "Llama 5", protocol: "openai-chat", gateway: "groq/llama-5" }]

// oxlint-disable-next-line ren/no-comments -- A stand-in for the Ren Inference Service: inference keys in memory, no connections, Ren with the given models and a free one, the free cap, Groq for an own key, and one key for every brain, for the inference service at `stub`.
export const start = (
  stub: string,
  options: { readonly models: () => ReadonlyArray<Models.Info>; readonly key?: string },
) => {
  const keys: Key[] = []
  const freeUsed = new Map<string, number>()
  // oxlint-disable-next-line ren/no-comments -- Every organization that asked for a brain key has Ren on, as in the inference service's LiteLLM teams.
  const organizations = new Set<string>()
  // oxlint-disable-next-line ren/no-comments -- Each organization's provider settings, as the inference service keeps them in LiteLLM (Providers P29).
  const settings = new Map<string, Record<string, ProviderSettings>>()
  const change = (input: Request, next: (current: ProviderSettings) => ProviderSettings) => {
    const org = input.claims?.org ?? ""
    const providers = settings.get(org) ?? {}
    settings.set(org, {
      ...providers,
      [input.provider]: next(providers[input.provider] ?? { enabled: true, off: [] }),
    })
  }
  const baseUrl = stub
  const notFound = () => Response.json({ error: "not found" }, { status: 404 })
  const seats = new Map<string, Array<Schema.Schema.Type<typeof RenInference.Connection> & { connectedBy: null }>>()
  const signIns = new Map<string, string>()
  // oxlint-disable-next-line ren/no-comments -- A provider's method: the one chosen, else the one it is connected by (a key before seats), as the inference service decides.
  const methodOf = (org: string, provider: string) => {
    const current = settings.get(org)?.[provider]
    if (current?.method) return current.method
    if (current?.key) return "key"
    return (seats.get(org) ?? []).some((seat) => seat.providerId === provider) ? "subscription" : "key"
  }
  const routes: Readonly<Record<string, (input: Request) => Response | Promise<Response>>> = {
    "GET /v1/connections": (input) => Response.json(seats.get(input.claims?.org ?? "") ?? []),
    "POST /v1/providers/:id/sign-in": (input) => {
      if (input.provider !== "anthropic") return Response.json({ error: "no sign-in" }, { status: 400 })
      const id = `ses_${crypto.randomUUID().slice(0, 8)}`
      signIns.set(id, input.claims?.org ?? "")
      return Response.json({
        id,
        url: `${stub}/claude-sign-in`,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        paste: "Paste the code Claude shows after you sign in.",
      })
    },
    "POST /v1/providers/:id/sign-in/:session": async (input) => {
      const session = new URL(input.request.url).pathname.split("/").at(-1) ?? ""
      if (signIns.get(session) !== input.claims?.org) return notFound()
      if (decodeCode(await input.request.json()).code !== "good-code")
        return Response.json({ error: "That code is not valid. Sign in again." }, { status: 400 })
      const org = input.claims?.org ?? ""
      seats.set(org, [
        ...(seats.get(org) ?? []),
        {
          id: `con_${crypto.randomUUID().slice(0, 8)}`,
          label: "Claude subscription",
          providerName: "Anthropic",
          providerId: "anthropic",
          iconUrl: "",
          status: { label: "Active", tone: "ok" },
          plan: "Max",
          canReconnect: false,
          canManage: true,
          limits: [],
          connectedBy: null,
        },
      ])
      return new Response(null, { status: 204 })
    },
    "POST /v1/keys": (input) => {
      if (input.claims?.org) organizations.add(input.claims.org)
      return Response.json({ key: options.key ?? "stub-key" })
    },
    "GET /v1/providers/ren/organizations": () => Response.json([...organizations]),
    "GET /v1/providers": () =>
      Response.json([
        {
          id: "ren",
          name: "Ren",
          payer: "ren",
          protocol: "openai-chat",
          auth: [{ _tag: "operator" }],
          models: "shared",
        },
        {
          id: "anthropic",
          name: "Anthropic",
          payer: "customer",
          protocol: "anthropic-messages",
          auth: [
            { _tag: "key", fields: [{ name: "apiKey", label: "API key", secret: true }] },
            {
              _tag: "subscription",
              signIn: "Connect your Claude",
              paste: "Paste the code Claude shows after you sign in.",
            },
          ],
          models: "organization",
          modelTypes: { chat: anthropicKeyModels.length },
        },
        {
          id: "groq",
          name: "Groq",
          payer: "customer",
          protocol: "openai-chat",
          auth: [{ _tag: "key", fields: [{ name: "apiKey", label: "API key", secret: true }] }],
          models: "shared",
          modelTypes: { chat: groq.length },
        },
      ]),
    "GET /v1/providers/:id/models": (input) => {
      const org = input.claims?.org ?? ""
      if (input.provider === "anthropic") {
        const listed = methodOf(org, "anthropic") === "subscription" ? anthropicSeatModels : anthropicKeyModels
        return Response.json({ revision: Bun.hash(JSON.stringify(listed)).toString(16), models: listed })
      }
      if (input.provider !== "ren" && input.provider !== "groq") return notFound()
      const listed = input.provider === "ren" ? [...options.models().map(asRenModel), freeModel] : groq
      return Response.json({ revision: Bun.hash(JSON.stringify(listed)).toString(16), models: listed })
    },
    "GET /v1/providers/:id/limits": (input) =>
      Response.json(
        input.provider === "ren" && new URL(input.request.url).searchParams.get("model") === freeModel.gateway
          ? [
              {
                _tag: "free",
                used: freeUsed.get(input.claims?.org ?? "") ?? 0,
                limit: 100,
                resetsAt: new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString(),
              },
            ]
          : [],
      ),
    "GET /v1/providers/settings": (input) => {
      const org = input.claims?.org ?? ""
      const stored = settings.get(org) ?? {}
      const seated = (seats.get(org) ?? []).length > 0 && !stored.anthropic
      return Response.json({
        ...stored,
        ...(seated && { anthropic: { enabled: true, method: "subscription", off: [] } }),
        ...(stored.anthropic && { anthropic: { ...stored.anthropic, method: methodOf(org, "anthropic") } }),
      })
    },
    "PUT /v1/providers/:id": async (input) => {
      const next = decodeChange(await input.request.json())
      change(input, (current) => ({ ...current, ...next }))
      return new Response(null, { status: 204 })
    },
    "PATCH /v1/providers/:id/models": async (input) => {
      const switches = decodeSwitches(await input.request.json()).models
      const ids = new Set(switches.map((each) => each.id))
      change(input, (current) => ({
        ...current,
        off: [
          ...current.off.filter((id) => !ids.has(id)),
          ...switches.filter((each) => !each.enabled).map((each) => each.id),
        ],
      }))
      return new Response(null, { status: 204 })
    },
    "POST /v1/providers/:id/test": async (input) =>
      Response.json(
        keyOf(await input.request.json()).startsWith("sk-good")
          ? { ok: true }
          : { ok: false, message: "Invalid API key." },
      ),
    "PUT /v1/providers/:id/key": async (input) => {
      const key = keyOf(await input.request.json())
      if (!key.startsWith("sk-good")) return Response.json({ error: "Invalid API key." }, { status: 400 })
      const saved = { last4: key.slice(-4), testedAt: new Date().toISOString() }
      const member = input.claims?.member
      change(input, (current) => ({ ...current, key: { ...saved, ...(member && { savedBy: member }) } }))
      return Response.json(saved)
    },
    "DELETE /v1/providers/:id/key": (input) => {
      change(input, (current) => ({
        enabled: current.enabled,
        ...(current.method && { method: current.method }),
        off: current.off,
      }))
      return new Response(null, { status: 204 })
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
      const provider = /^\/v1\/providers\/([^/]+)/u.exec(url.pathname)?.[1] ?? ""
      const path = url.pathname
        .replace(/ifk_\w+/u, ":id")
        .replace(/^\/v1\/providers\/[^/]+/u, "/v1/providers/:id")
        .replace(/\/sign-in\/[^/]+$/u, "/sign-in/:session")
      const route = routes[`${request.method} ${url.pathname}`] ?? routes[`${request.method} ${path}`]
      if (route) return route({ request, claims, found, provider })
      if (request.method === "DELETE") return new Response(null, { status: 204 })
      return fetch(new URL(`${url.pathname}${url.search}`, stub), {
        headers: request.headers,
      })
    },
  })
  return {
    url: `http://127.0.0.1:${server.port}`,
    // oxlint-disable-next-line ren/no-comments -- A test sets an organization's free requests of today, as the inference service counts them.
    setFreeUsed: (org: string, used: number) => void freeUsed.set(org, used),
    stop: () => server.stop(true),
  }
}
