import { describe, expect } from "bun:test"
import { Testing } from "@ren/db/testing"
import { Signature } from "@ren/schema/signature"
import { ConfigProvider, Effect, Exit, Layer, Option, Queue, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { Billing } from "../src/billing.js"
import { DurableRunner } from "../src/durable-runner.js"
import { Onboarding } from "../src/onboarding.js"
import { OnboardingRewards } from "../src/onboarding-rewards.js"
import { Signer } from "../src/signer.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const key = await Effect.runPromise(Signature.generate("ren-billing-test"))

const Claims = Schema.Struct({ kid: Schema.String, exp: Schema.Number, org: Schema.String })

const grants = Effect.runSync(Queue.unbounded<{ readonly org: string; readonly body: unknown }>())

const billing = Bun.serve({
  port: 0,
  fetch: async (request) => {
    const token = request.headers.get("authorization")?.replace(/^Bearer /u, "") ?? ""
    const claims = await Effect.runPromise(Signature.verify([key.publicKey], Claims, token))
    if (Option.isNone(claims) || new URL(request.url).pathname !== "/billing/v1/grants")
      return new Response(null, { status: 404 })
    await Effect.runPromise(Queue.offer(grants, { org: claims.value.org, body: await request.json() }))
    return new Response(null, { status: 204 })
  },
})

const layer = (rewards: unknown) =>
  Onboarding.layer.pipe(
    Layer.provide(OnboardingRewards.layer),
    Layer.provide([Billing.layerConfig, DurableRunner.layerMemory]),
    Layer.provide([Signer.layerLocal, FetchHttpClient.layer]),
    Layer.provideMerge(Testing.layer),
    Layer.provide(
      ConfigProvider.layerAdd(
        ConfigProvider.fromUnknown({
          REN_BILLING_URL: `http://127.0.0.1:${billing.port}`,
          REN_BILLING_KEYS: JSON.stringify([
            { id: key.privateKey.id, key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(key.privateKey.key) },
          ]),
          ONBOARDING_REWARDS: JSON.stringify(rewards),
        }),
        { asPrimary: true },
      ),
    ),
  )

const it = testEffect(
  layer({
    [Onboarding.steps.organization.memberJoined]: { microUsd: 5_000_000 },
    [Onboarding.steps.organization.slackConnected]: { microUsd: 10_000_000 },
    [Onboarding.steps.personal.gmailConnected]: { microUsd: 2_000_000 },
  }),
)

describe("OnboardingRewards", () => {
  it.live("grants an organization step's configured credits the first time it completes, and nothing else", () =>
    Effect.gen(function* () {
      const onboarding = yield* Onboarding.Service
      const organizationId = yield* Seed.organization()
      yield* onboarding.record(organizationId, Onboarding.steps.organization.memberJoined)
      expect(yield* Queue.take(grants)).toEqual({
        org: organizationId,
        body: { microUsd: 5_000_000, key: `onboarding:${Onboarding.steps.organization.memberJoined}` },
      })
      yield* onboarding.record(organizationId, Onboarding.steps.organization.memberJoined)
      yield* onboarding.record(organizationId, Onboarding.steps.organization.slackConnected)
      expect(yield* Queue.take(grants)).toEqual({
        org: organizationId,
        body: { microUsd: 10_000_000, key: `onboarding:${Onboarding.steps.organization.slackConnected}` },
      })
      expect(yield* Queue.size(grants)).toBe(0)
    }),
  )

  it.live("credits the organization once for each member who completes a personal step", () =>
    Effect.gen(function* () {
      const onboarding = yield* Onboarding.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* Seed.actor(organizationId, "owner")
      const grace = yield* Seed.actor(organizationId, "member")
      yield* onboarding.recordPersonal(ada, Onboarding.steps.personal.gmailConnected)
      yield* onboarding.recordPersonal(ada, Onboarding.steps.personal.gmailConnected)
      yield* onboarding.recordPersonal(grace, Onboarding.steps.personal.gmailConnected)
      expect(yield* Queue.takeN(grants, 2)).toEqual(
        expect.arrayContaining(
          [ada, grace].map((person) => ({
            org: organizationId,
            body: {
              microUsd: 2_000_000,
              key: `onboarding:${Onboarding.steps.personal.gmailConnected}:${person.userId}`,
            },
          })),
        ),
      )
      expect(yield* Queue.size(grants)).toBe(0)
    }),
  )

  it.live("gives nothing for a step completed before its reward was configured", () =>
    Effect.gen(function* () {
      const organizationId = yield* Seed.organization()
      yield* Effect.flatMap(Onboarding.Service, (onboarding) =>
        onboarding.record(organizationId, Onboarding.steps.organization.memberJoined),
      ).pipe(Effect.provide(Layer.fresh(Onboarding.layer)))
      const onboarding = yield* Onboarding.Service
      yield* onboarding.record(organizationId, Onboarding.steps.organization.memberJoined)
      yield* onboarding.record(organizationId, Onboarding.steps.organization.slackConnected)
      expect((yield* Queue.take(grants)).body).toMatchObject({
        key: `onboarding:${Onboarding.steps.organization.slackConnected}`,
      })
      expect(yield* Queue.size(grants)).toBe(0)
    }),
  )

  it.live("refuses to start with a reward for a step that does not exist", () =>
    Effect.gen(function* () {
      const started = yield* Effect.exit(Layer.build(Layer.fresh(layer({ "made.up": { microUsd: 1 } }))))
      expect(Exit.isFailure(started)).toBe(true)
    }),
  )
})
