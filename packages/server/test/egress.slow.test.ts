import { afterAll, beforeAll, describe, expect, setDefaultTimeout } from "bun:test"
import { Access } from "@ren/core/access"
import { BrainClient } from "@ren/core/brain-client"
import { CredentialCallers } from "@ren/core/credential-callers"
import { CredentialSource } from "@ren/core/credential-source"
import { Credentials } from "@ren/core/credentials"
import { Egress } from "@ren/core/egress"
import { EgressControl } from "@ren/core/egress-control"
import { Envelope } from "@ren/core/envelope"
import { Models } from "@ren/core/models"
import { Signer } from "@ren/core/signer"
import { Seed, testEffect } from "@ren/core/testing"
import { Testing } from "@ren/db/testing"
import { BrainToken } from "@ren/host-api/brain-token"
import { Brain } from "@ren/schema/brain"
import { Signature } from "@ren/schema/signature"
import { ConfigProvider, Effect, Layer, Option, Redacted, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { EgressRoutes } from "../src/egress.js"
import { EgressHarness } from "./lib/egress.js"

setDefaultTimeout(120_000)

const brainKey = await Effect.runPromise(Signature.generate("brain"))

const seen: Array<{
  readonly host: string
  readonly path: string
  readonly query: string
  readonly authorization: string | null
  readonly body: string
}> = []

const upstream = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async (request) => {
    const url = new URL(request.url)
    seen.push({
      host: request.headers.get("host") ?? "",
      path: url.pathname,
      query: url.search,
      authorization: request.headers.get("authorization"),
      body: await request.text(),
    })
    if (url.pathname === "/redirect") return Response.redirect(`http://other.test:${url.port}/landing`, 302)
    if (url.pathname === "/events")
      return new Response(
        new ReadableStream({
          start: (controller) => {
            controller.enqueue(new TextEncoder().encode("data: one\n\n"))
            controller.enqueue(new TextEncoder().encode("data: two\n\n"))
            controller.close()
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    if (url.pathname === "/hold") return new Response(new ReadableStream({ start: () => {} }))
    return Response.json({ authorization: request.headers.get("authorization"), query: url.search })
  },
})

const state: {
  certificates?: EgressHarness.Certificates
  binary?: string
  egress?: EgressHarness.Instance
  renPort: number
} = { renPort: EgressHarness.freePort() }

beforeAll(async () => {
  state.certificates = await EgressHarness.certificates()
  state.binary = await EgressHarness.build()
}, 600_000)

afterAll(async () => {
  await state.egress?.stop()
  await upstream.stop(true)
  if (state.certificates) await EgressHarness.cleanup(state.certificates)
})

const certificates = () => {
  if (!state.certificates) throw new Error("certificates were not made")
  return state.certificates
}

const ren = () => {
  const certs = certificates()
  return EgressRoutes.serve.pipe(
    Layer.provideMerge(Egress.layer),
    Layer.provideMerge(CredentialSource.layer),
    Layer.provideMerge(Layer.mergeAll(CredentialSource.layerStatic, CredentialSource.layerMinted)),
    Layer.provideMerge(Layer.mergeAll(Credentials.layer, CredentialCallers.layer, BrainClient.layer, Models.layerNone)),
    Layer.provideMerge(Layer.mergeAll(Access.layer, Envelope.layerLocal, EgressControl.layerHttp, Signer.layerLocal)),
    Layer.provideMerge(Testing.layer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          ENVELOPE_KEYS: JSON.stringify([
            { id: "local:test", key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url") },
          ]),
          BRAIN_KEYS: JSON.stringify([
            {
              id: brainKey.privateKey.id,
              key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(brainKey.privateKey.key),
            },
          ]),
          REN_URL: `http://ren.test:${upstream.port}`,
          EGRESS_PORT: String(state.renPort),
          EGRESS_TLS_CERT: certs.serverCert,
          EGRESS_TLS_KEY: certs.serverKey,
          EGRESS_TLS_CA: certs.ca,
          EGRESS_CONTROL_URLS: `https://127.0.0.1:${state.egress?.control ?? 0}`,
          EGRESS_CONTROL_TLS_CERT: certs.clientCert,
          EGRESS_CONTROL_TLS_KEY: certs.clientKey,
          EGRESS_CONTROL_TLS_CA: certs.ca,
        }),
      ),
    ),
  )
}

const egress = async () => {
  if (!state.egress) {
    if (!state.binary) throw new Error("the egress was not built")
    state.egress = await EgressHarness.start({
      binary: state.binary,
      certificates: certificates(),
      hook: `https://localhost:${state.renPort}`,
    })
  }
  return state.egress
}

const it = testEffect(Layer.unwrap(Effect.promise(() => egress().then(ren))))

const setup = Effect.fnUntraced(function* () {
  const callers = yield* CredentialCallers.Service
  const credentials = yield* Credentials.Service
  const organizationId = yield* Seed.organization()
  const ada = yield* Seed.actor(organizationId, "member")
  const spaceId = yield* Seed.space(organizationId)
  const brainId = Brain.ID.create()
  yield* Seed.session({ organizationId, spaceId, createdBy: ada.userId, brainId })
  yield* credentials.create(ada, {
    owner: { kind: "org" },
    label: "STRIPE_API_KEY",
    hosts: ["api.stripe.test"],
    value: { type: "key", value: Redacted.make("sk_live_real") },
    inject: { op: "replace", in: ["header", "query"] },
  })
  const placement = yield* callers.issue(
    { workload: { kind: "brain", id: brainId, generation: 1 }, organizationId },
    "ProxyLogin",
  )
  if (placement.kind !== "ProxyLogin") return yield* Effect.die(new Error("expected a proxy login"))
  return { brainId, organizationId, login: placement.username, password: Redacted.value(placement.password) }
})

const socks = (login: string, password: string) =>
  `--proxy socks5h://${login}:${password}@127.0.0.1:${state.egress?.tunnel ?? 0}`

const http = (login: string, password: string) =>
  `--proxy http://${login}:${password}@127.0.0.1:${state.egress?.tunnel ?? 0}`

const at = (path: string, host = "api.stripe.test") => `'http://${host}:${upstream.port}${path}'`

describe("egress (iron-proxy fork) with Ren", () => {
  it.live(
    "a process with only the placeholder reaches the upstream with the real key, over SOCKS5 and HTTP proxy",
    () =>
      Effect.gen(function* () {
        const found = yield* setup()
        const env = { STRIPE_API_KEY: "ren:STRIPE_API_KEY" }
        const viaSocks = yield* Effect.promise(() =>
          EgressHarness.curl(
            [socks(found.login, found.password), "-H", '"Authorization: Bearer $STRIPE_API_KEY"', at("/v1/charges")],
            env,
          ),
        )
        expect(viaSocks.status).toBe(200)
        expect(seen.findLast((request) => request.path === "/v1/charges")?.authorization).toBe("Bearer sk_live_real")
        expect(JSON.parse(viaSocks.body)).toMatchObject({ authorization: "Bearer ren:STRIPE_API_KEY" })
        const viaHttp = yield* Effect.promise(() =>
          EgressHarness.curl(
            [
              http(found.login, found.password),
              `"http://api.stripe.test:${upstream.port}/v1/charges?key=$STRIPE_API_KEY"`,
            ],
            env,
          ),
        )
        expect(seen.findLast((request) => request.path === "/v1/charges")?.query).toBe("?key=sk_live_real")
        expect(viaHttp.body).not.toContain("sk_live_real")
      }),
  )

  it.live("a JSON request body passes through the egress to the upstream unchanged", () =>
    Effect.gen(function* () {
      const found = yield* setup()
      const sent = yield* Effect.promise(() =>
        EgressHarness.curl([
          socks(found.login, found.password),
          "-H",
          "'Authorization: Bearer ren:STRIPE_API_KEY'",
          "-H",
          "'Content-Type: application/json'",
          "-d",
          `'{"amount":42}'`,
          at("/v1/json"),
        ]),
      )
      expect(sent.status).toBe(200)
      expect(seen.findLast((request) => request.path === "/v1/json")?.body).toBe('{"amount":42}')
    }),
  )

  it.live("a POST with no body reaches the upstream with Content-Length 0, which Bun requires", () =>
    Effect.gen(function* () {
      const found = yield* setup()
      const sent = yield* Effect.promise(() =>
        EgressHarness.curl([socks(found.login, found.password), "-X", "POST", at("/v1/empty")]),
      )
      expect(sent.status).toBe(200)
    }),
  )

  it.live("a request with a label Ren does not have is not forwarded: 403 with the reason and the label", () =>
    Effect.gen(function* () {
      const found = yield* setup()
      const before = seen.length
      const denied = yield* Effect.promise(() =>
        EgressHarness.curl([socks(found.login, found.password), "-H", "'X-Api-Key: ren:MISSING'", at("/v1/charges")]),
      )
      expect(denied.status).toBe(403)
      expect(denied.head.toLowerCase()).toContain("x-ren-egress: credential_missing")
      expect(JSON.parse(denied.body)).toEqual({
        error: "ren_credential_missing",
        label: "MISSING",
      })
      expect(seen.length).toBe(before)
    }),
  )

  it.live("a wrong proxy login gets no tunnel", () =>
    Effect.gen(function* () {
      const found = yield* setup()
      const refused = yield* Effect.promise(() => EgressHarness.curl([http(found.login, "wrong"), at("/v1/charges")]))
      expect(refused.status).toBe(407)
      const socksRefused = yield* Effect.promise(() =>
        EgressHarness.curl([socks(found.login, "wrong"), at("/v1/charges")]),
      )
      expect(socksRefused.status).toBe(0)
    }),
  )

  it.live("a request for another host than the tunnel's target is refused, and no credential leaves", () =>
    Effect.gen(function* () {
      const found = yield* setup()
      const before = seen.length
      const refused = yield* Effect.promise(() =>
        EgressHarness.curl([
          socks(found.login, found.password),
          "-H",
          `'Host: other.test:${upstream.port}'`,
          "-H",
          "'Authorization: Bearer ren:STRIPE_API_KEY'",
          at("/v1/charges"),
        ]),
      )
      expect(refused.status).toBe(403)
      expect(refused.head.toLowerCase()).toContain("x-ren-egress: host_mismatch")
      expect(seen.length).toBe(before)
    }),
  )

  it.live("the egress does not follow a redirect; the request to the other host gets no credential", () =>
    Effect.gen(function* () {
      const found = yield* setup()
      const first = yield* Effect.promise(() =>
        EgressHarness.curl([
          socks(found.login, found.password),
          "-H",
          "'Authorization: Bearer ren:STRIPE_API_KEY'",
          at("/redirect"),
        ]),
      )
      expect(first.status).toBe(302)
      const second = yield* Effect.promise(() =>
        EgressHarness.curl([
          socks(found.login, found.password),
          "-H",
          "'Authorization: Bearer ren:STRIPE_API_KEY'",
          at("/landing", "other.test"),
        ]),
      )
      expect(second.status).toBe(403)
      expect(second.head.toLowerCase()).toContain("x-ren-egress: host_not_allowed")
      expect(seen.some((request) => request.path === "/landing")).toBe(false)
    }),
  )

  it.live("a server-sent events stream gets the credential and every event", () =>
    Effect.gen(function* () {
      const found = yield* setup()
      const stream = yield* Effect.promise(() =>
        EgressHarness.curl([
          socks(found.login, found.password),
          "-N",
          "-H",
          "'Authorization: Bearer ren:STRIPE_API_KEY'",
          at("/events"),
        ]),
      )
      expect(stream.body).toBe("data: one\n\ndata: two\n\n")
      expect(seen.findLast((request) => request.path === "/events")?.authorization).toBe("Bearer sk_live_real")
    }),
  )

  it.live("a call to Ren's host reaches Ren with the brain's host token, which the brain never holds", () =>
    Effect.gen(function* () {
      const found = yield* setup()
      const reply = yield* Effect.promise(() =>
        EgressHarness.curl([
          socks(found.login, found.password),
          "-H",
          "'Authorization: Bearer ren:REN'",
          at("/host/pull", "ren.test"),
        ]),
      )
      expect(reply.status).toBe(200)
      expect(reply.body).not.toContain("Bearer ey")
      const authorization = seen.findLast((request) => request.path === "/host/pull")?.authorization ?? ""
      const token = authorization.replace(/^Bearer /u, "")
      const claims = yield* BrainToken.verify([brainKey.publicKey], token)
      expect(Option.map(claims, (found) => [found.scope, found.brain])).toEqual(Option.some(["host", found.brainId]))
    }),
  )

  it.live("after Ren revokes a login, its open connection is closed and a new one is refused", () =>
    Effect.gen(function* () {
      const found = yield* setup()
      const callers = yield* CredentialCallers.Service
      const control = yield* EgressControl.Service
      const held = EgressHarness.curl([socks(found.login, found.password), "-N", at("/hold")])
      yield* Effect.promise(async () => {
        // ast-grep-ignore: no-test-sleep -- the request comes from a curl process through the egress; the test sees it only when the upstream records it
        while (!seen.some((request) => request.path === "/hold")) await Bun.sleep(20)
      })
      const revoked = yield* callers.revoke({ kind: "brain", id: found.brainId })
      yield* Effect.forEach(revoked.logins, (login) => control.invalidate({ login }), { discard: true })
      const closed = yield* Effect.promise(() => held)
      expect(closed.stderr).not.toContain("timed out")
      const again = yield* Effect.promise(() =>
        EgressHarness.curl([socks(found.login, found.password), at("/v1/charges")]),
      )
      expect(again.status).toBe(0)
    }),
  )
})
