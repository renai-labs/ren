import { afterAll, describe, expect } from "bun:test"
import { Testing } from "@ren/db/testing"
import type { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Injection } from "@ren/schema/injection"
import { Signature } from "@ren/schema/signature"
import { ConfigProvider, Effect, Layer, Redacted, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { Access } from "../src/access.js"
import { BrainClient } from "../src/brain-client.js"
import { CredentialCallers } from "../src/credential-callers.js"
import { CredentialSource } from "../src/credential-source.js"
import { Credentials } from "../src/credentials.js"
import { Egress } from "../src/egress.js"
import { EgressControl } from "../src/egress-control.js"
import { Envelope } from "../src/envelope.js"
import { Models } from "../src/models.js"
import { Signer } from "../src/signer.js"
import { Space } from "../src/space.js"
import { SpaceMember } from "../src/space/member.js"
import { SpaceProvisioning } from "../src/space/provisioning.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const invalidations: Array<unknown> = []
const egress = Bun.serve({
  port: 0,
  fetch: async (request) => {
    invalidations.push(await request.json())
    return new Response(null, { status: 204 })
  },
})
afterAll(() => egress.stop(true))

const brainKey = await Effect.runPromise(Signature.generate("brain"))

const it = testEffect(
  Layer.mergeAll(Egress.layer, Space.layer, SpaceMember.layer, SpaceProvisioning.layer).pipe(
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
          EGRESS_CONTROL_URLS: `http://127.0.0.1:${egress.port}`,
        }),
      ),
    ),
  ),
)

const everyOp = Injection.opNames

const all: Egress.Principal = { kind: "ren", orgs: "all" }

const setup = Effect.fnUntraced(function* () {
  const callers = yield* CredentialCallers.Service
  const spaces = yield* Space.Service
  const provisioning = yield* SpaceProvisioning.Service
  const organizationId = yield* Seed.organization()
  const seeded = yield* Seed.user()
  yield* Seed.member(organizationId, seeded.id, "member")
  yield* provisioning.createInitialMemberships(organizationId, seeded)
  const ada = { userId: seeded.id, organizationId, roles: ["member"] }
  const space = yield* spaces.create(ada, { name: "Team" })
  const brainId = Brain.ID.create()
  yield* Seed.session({ organizationId, spaceId: space.id, createdBy: ada.userId, brainId })
  const placement = yield* callers.issue(
    { workload: { kind: "brain", id: brainId, generation: 1 }, organizationId },
    "ProxyLogin",
  )
  if (placement.kind !== "ProxyLogin") return yield* Effect.die(new Error("expected a proxy login"))
  const proof: CredentialCallers.Proof = {
    kind: "ProxyLogin",
    username: placement.username,
    password: placement.password,
  }
  return { organizationId, ada, space, brainId, proof }
})

const request = (
  proof: CredentialCallers.Proof,
  host: string,
  placeholders: ReadonlyArray<string>,
  ops: ReadonlyArray<Injection.OpName> = everyOp,
) => ({ proof, host, port: 443, method: "POST", path: "/v1/charges", placeholders, ops })

const values = (reply: Injection.Reply) =>
  reply.allow
    ? reply.inject.map((op) =>
        op.op === "route"
          ? { op: op.op, upstream: Redacted.value(op.upstream) }
          : { ...op, value: Redacted.value(op.value) },
      )
    : reply

describe("Egress.resolve", () => {
  it.live("a brain's placeholder becomes its space's key, for the key's host only", () =>
    Effect.gen(function* () {
      const resolver = yield* Egress.Service
      const credentials = yield* Credentials.Service
      const found = yield* setup()
      yield* credentials.create(found.ada, {
        owner: { kind: "space", spaceId: found.space.id },
        label: "STRIPE_API_KEY",
        hosts: ["api.stripe.com"],
        value: { type: "key", value: Redacted.make("sk_live_real") },
      })
      const reply = yield* resolver.resolve(all, request(found.proof, "api.stripe.com", ["ren:STRIPE_API_KEY"]))
      expect(reply).toMatchObject({ allow: true, workload: `brain:${found.brainId}:1`, ttl: 30 })
      expect(values(reply)).toEqual([
        { op: "replace", placeholder: "ren:STRIPE_API_KEY", value: "sk_live_real", in: ["header", "query", "path"] },
      ])
      expect(yield* resolver.resolve(all, request(found.proof, "evil.example.com", ["ren:STRIPE_API_KEY"]))).toEqual({
        allow: false,
        reason: "host_not_allowed",
        label: "STRIPE_API_KEY",
      })
    }),
  )

  it.live("a principal limited to one org gets principal_scope for a workload of another org", () =>
    Effect.gen(function* () {
      const resolver = yield* Egress.Service
      const found = yield* setup()
      const otherOrg: Auth.OrganizationID = yield* Seed.organization()
      expect(
        yield* resolver.resolve({ kind: "registered", orgs: [otherOrg] }, request(found.proof, "api.stripe.com", [])),
      ).toEqual({
        allow: false,
        reason: "principal_scope",
      })
      expect(
        yield* resolver.resolve(
          { kind: "registered", orgs: [found.organizationId] },
          request(found.proof, "api.stripe.com", []),
        ),
      ).toMatchObject({
        allow: true,
      })
    }),
  )

  it.live("a value with CR or LF never goes into a header; a basic credential becomes Basic base64(user:pass)", () =>
    Effect.gen(function* () {
      const resolver = yield* Egress.Service
      const credentials = yield* Credentials.Service
      const found = yield* setup()
      yield* credentials.create(found.ada, {
        owner: { kind: "org" },
        label: "BROKEN",
        hosts: ["api.broken.dev"],
        value: { type: "key", value: Redacted.make("line\r\nX-Injected: 1") },
      })
      expect(yield* resolver.resolve(all, request(found.proof, "api.broken.dev", ["ren:BROKEN"]))).toEqual({
        allow: false,
        reason: "credential_missing",
        label: "BROKEN",
      })
      yield* credentials.create(found.ada, {
        owner: { kind: "org" },
        label: "JIRA",
        hosts: ["acme.atlassian.net"],
        value: { type: "basic", username: "ada@acme.dev", password: Redacted.make('p&ss/"') },
      })
      expect(values(yield* resolver.resolve(all, request(found.proof, "acme.atlassian.net", [])))).toEqual([
        {
          op: "setHeader",
          name: "Authorization",
          value: `Basic ${Buffer.from('ada@acme.dev:p&ss/"').toString("base64")}`,
        },
      ])
    }),
  )

  it.live("a missing label is named and works on the next request once saved; a delete clears every egress copy", () =>
    Effect.gen(function* () {
      const resolver = yield* Egress.Service
      const credentials = yield* Credentials.Service
      const found = yield* setup()
      expect(yield* resolver.resolve(all, request(found.proof, "api.linear.app", ["ren:LINEAR_API_KEY"]))).toEqual({
        allow: false,
        reason: "credential_missing",
        label: "LINEAR_API_KEY",
      })
      const saved = yield* credentials.create(found.ada, {
        owner: { kind: "space", spaceId: found.space.id },
        label: "LINEAR_API_KEY",
        hosts: ["api.linear.app"],
        value: { type: "key", value: Redacted.make("lin_api_1") },
      })
      expect(
        yield* resolver.resolve(all, request(found.proof, "api.linear.app", ["ren:LINEAR_API_KEY"])),
      ).toMatchObject({
        allow: true,
      })
      invalidations.length = 0
      yield* credentials.remove(found.ada, saved.id, {})
      expect(invalidations).toEqual([{ label: "LINEAR_API_KEY" }])
      expect(yield* resolver.resolve(all, request(found.proof, "api.linear.app", ["ren:LINEAR_API_KEY"]))).toEqual({
        allow: false,
        reason: "credential_missing",
        label: "LINEAR_API_KEY",
      })
    }),
  )

  it.live(
    "an egress that does not report route gets egress_outdated for a route credential, and replace still works",
    () =>
      Effect.gen(function* () {
        const resolver = yield* Egress.Service
        const credentials = yield* Credentials.Service
        const found = yield* setup()
        const old: ReadonlyArray<Injection.OpName> = ["replace", "setHeader"]
        expect(yield* resolver.resolve(all, request(found.proof, "ren.internal", [], old))).toEqual({
          allow: false,
          reason: "egress_outdated",
          label: "REN",
        })
        yield* credentials.create(found.ada, {
          owner: { kind: "org" },
          label: "STRIPE_API_KEY",
          hosts: ["api.stripe.com"],
          value: { type: "key", value: Redacted.make("sk_live_real") },
        })
        expect(
          yield* resolver.resolve(all, request(found.proof, "api.stripe.com", ["ren:STRIPE_API_KEY"], old)),
        ).toMatchObject({
          allow: true,
        })
      }),
  )

  it.live("an unknown login is unknown_workload", () =>
    Effect.gen(function* () {
      const resolver = yield* Egress.Service
      expect(
        yield* resolver.resolve(
          all,
          request({ kind: "ProxyLogin", username: "nobody", password: Redacted.make("x") }, "api.stripe.com", []),
        ),
      ).toEqual({ allow: false, reason: "unknown_workload" })
    }),
  )
})
