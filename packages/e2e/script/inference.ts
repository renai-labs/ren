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

// oxlint-disable-next-line ren/no-comments -- A model of the Ren provider: its gateway name and price, unless the test gave its own.
const asRenModel = (model: Models.Info): Models.Info =>
  Struct.assign({ gateway: `ren/${model.id}`, price: { input: 1, output: 2 } }, model)

// oxlint-disable-next-line ren/no-comments -- A stand-in for the Ren Inference Service: inference keys in memory, no connections, one provider (Ren) with the given models, and one key for every brain, for the model gateway at `stub`.
export const start = (
  stub: string,
  options: { readonly models: () => ReadonlyArray<Models.Info>; readonly key?: string },
) => {
  const keys: Key[] = []
  // oxlint-disable-next-line ren/no-comments -- Every organization that asked for a brain key has Ren on, as in the gateway's LiteLLM teams.
  const organizations = new Set<string>()
  const baseUrl = stub
  const notFound = () => Response.json({ error: "not found" }, { status: 404 })
  const routes: Readonly<Record<string, (input: Request) => Response | Promise<Response>>> = {
    "GET /v1/connections": () => Response.json([]),
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
          mark: "ren",
          payer: "ren",
          protocol: "openai-chat",
          auth: [{ _tag: "operator" }],
          models: "shared",
        },
      ]),
    "GET /v1/providers/ren/models": () => {
      const listed = options.models().map(asRenModel)
      return Response.json({ revision: Bun.hash(JSON.stringify(listed)).toString(16), models: listed })
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
      const route = routes[`${request.method} ${url.pathname.replace(/ifk_\w+/u, ":id")}`]
      if (route) return route({ request, claims, found })
      if (request.method === "DELETE") return new Response(null, { status: 204 })
      return fetch(new URL(`${url.pathname}${url.search}`, stub), {
        headers: request.headers,
      })
    },
  })
  return {
    url: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  }
}
