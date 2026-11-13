import { afterAll, describe, expect } from "bun:test"
import { Testing } from "@ren/db/testing"
import { Brain } from "@ren/schema/brain"
import { Signature } from "@ren/schema/signature"
import { ConfigProvider, Effect, Exit, Layer, Option, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { CredentialCallers } from "../src/credential-callers.js"
import { EgressControl } from "../src/egress-control.js"
import { Envelope } from "../src/envelope.js"
import { SandboxEgress } from "../src/sandbox-egress.js"
import { Signer } from "../src/signer.js"
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

const key = await Effect.runPromise(Signature.generate("brain"))

const config = (options: { readonly envelope: boolean; readonly split?: boolean }) =>
  ConfigProvider.layer(
    ConfigProvider.fromUnknown({
      ...(options.split && { EGRESS_MODE: "split", EGRESS_IDENTITY_URL: "https://egress.ren.dev" }),
      ...(options.envelope && {
        ENVELOPE_KEYS: JSON.stringify([
          { id: "local:test", key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url") },
        ]),
      }),
      BRAIN_KEYS: JSON.stringify([
        { id: key.privateKey.id, key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(key.privateKey.key) },
      ]),
      EGRESS_PROXY_ADDRESS: "egress.example.com:1080",
      EGRESS_CONTROL_URLS: `http://127.0.0.1:${egress.port}`,
    }),
  )

const layer = (options: { readonly envelope: boolean; readonly split?: boolean }) =>
  SandboxEgress.layer.pipe(
    Layer.provideMerge(CredentialCallers.layer),
    Layer.provideMerge(Layer.mergeAll(Signer.layerLocal, Envelope.layerLocal, EgressControl.layerHttp)),
    Layer.provideMerge(Testing.layer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(config(options)),
  )

const it = testEffect(layer({ envelope: true }))

describe("SandboxEgress", () => {
  it.live("Ren does not start with an egress but no ENVELOPE_KEYS, so no brain waits forever in creating", () =>
    Effect.gen(function* () {
      const built = yield* Effect.promise(() =>
        Effect.runPromiseExit(Effect.scoped(Layer.build(layer({ envelope: false })))),
      )
      expect(Exit.isFailure(built)).toBe(true)
      expect(String(Exit.isFailure(built) ? built.cause : "")).toContain("ENVELOPE_KEYS")
    }),
  )

  it.live("retire revokes the brain's proxy login at once and tells the egress to close its connections", () =>
    Effect.gen(function* () {
      const sandboxEgress = yield* SandboxEgress.Service
      const callers = yield* CredentialCallers.Service
      const owner = yield* Seed.owner()
      const brainId = Brain.ID.create()
      yield* Seed.session({ ...owner, brainId })
      const proxy = yield* sandboxEgress.proxyFor({
        workload: { kind: "brain", id: brainId, generation: 1 },
        organizationId: owner.organizationId,
      })
      if (Option.isNone(proxy)) return yield* Effect.die(new Error("expected a proxy"))
      invalidations.length = 0
      yield* sandboxEgress.retire({ kind: "brain", id: brainId })
      expect(
        yield* callers.verify({ kind: "ProxyLogin", username: proxy.value.username, password: proxy.value.password }),
      ).toEqual({ ok: false, reason: "generation_retired" })
      expect(invalidations).toEqual([{ login: proxy.value.username }, { workload: `brain:${brainId}:` }])
    }),
  )
})

describe("SandboxEgress in split mode", () => {
  const split = testEffect(layer({ envelope: true, split: true }))

  split.live(
    "a machine gets the identity entry once per generation; retire drops the egress's answers by workload",
    () =>
      Effect.gen(function* () {
        const sandboxEgress = yield* SandboxEgress.Service
        const owner = yield* Seed.owner()
        const brainId = Brain.ID.create()
        yield* Seed.session({ ...owner, brainId })
        const machine = {
          workload: { kind: "brain" as const, id: brainId, generation: 1 },
          organizationId: owner.organizationId,
        }
        expect(yield* sandboxEgress.identityFor(machine)).toEqual(Option.some({ url: "https://egress.ren.dev" }))
        invalidations.length = 0
        expect(yield* sandboxEgress.identityFor(machine)).toEqual(Option.some({ url: "https://egress.ren.dev" }))
        expect(invalidations).toEqual([])
        yield* sandboxEgress.retire({ kind: "brain", id: brainId })
        expect(invalidations).toEqual([{ workload: `brain:${brainId}:` }])
      }),
  )
})
