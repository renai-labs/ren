import { describe, expect } from "bun:test"
import { Testing } from "@ren/db/testing"
import { Signature } from "@ren/schema/signature"
import { ConfigProvider, Effect, Layer, Option, Queue, Schema } from "effect"
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
    [Onboarding.steps.organization.slackConnected]: { microUsd: 3_000_000 },
    [Onboarding.steps.organization.githubConnected]: { microUsd: 3_000_000 },
    [Onboarding.steps.organization.memberJoined]: { microUsd: 1_000_000, upTo: 2 },
    [Onboarding.steps.personal.appsConnected]: { microUsd: 3_000_000, upTo: 2 },
  }),
)

const grant = (org: string, microUsd: number, key: string) => ({ org, body: { microUsd, key } })

describe("OnboardingRewards", () => {
  it.live("pays an organization step once, the first time it completes", () =>
    Effect.gen(function* () {
      const onboarding = yield* Onboarding.Service
      const organizationId = yield* Seed.organization()
      yield* onboarding.record(organizationId, Onboarding.steps.organization.slackConnected)
      yield* onboarding.record(organizationId, Onboarding.steps.organization.slackConnected)
      expect(yield* Queue.take(grants)).toEqual(grant(organizationId, 3_000_000, "onboarding:slack.connected"))
      yield* onboarding.record(organizationId, Onboarding.steps.organization.githubConnected)
      expect(yield* Queue.take(grants)).toEqual(grant(organizationId, 3_000_000, "onboarding:github.connected"))
      yield* onboarding.record(organizationId, Onboarding.steps.organization.artifactCreated)
      expect(yield* Queue.size(grants)).toBe(0)
    }),
  )

  it.live("pays a personal step once for each member who completes it, up to the reward's limit", () =>
    Effect.gen(function* () {
      const onboarding = yield* Onboarding.Service
      const organizationId = yield* Seed.organization()
      const members = yield* Effect.all([
        Seed.actor(organizationId, "owner"),
        Seed.actor(organizationId, "member"),
        Seed.actor(organizationId, "member"),
      ])
      yield* Effect.forEach(
        [...members, ...members],
        (person) => onboarding.recordPersonal(person, Onboarding.steps.personal.appsConnected),
        { discard: true },
      )
      expect(yield* Queue.takeN(grants, 2)).toEqual(
        expect.arrayContaining(
          members
            .slice(0, 2)
            .map((person) => grant(organizationId, 3_000_000, `onboarding:apps.connected:${person.userId}`)),
        ),
      )
      expect(yield* Queue.size(grants)).toBe(0)
      const other = yield* Seed.organization()
      yield* onboarding.recordPersonal(yield* Seed.actor(other, "owner"), Onboarding.steps.personal.appsConnected)
      expect((yield* Queue.take(grants)).org).toBe(other)
    }),
  )

  it.live("pays for each member who joins, once each, up to the reward's limit", () =>
    Effect.gen(function* () {
      const onboarding = yield* Onboarding.Service
      const organizationId = yield* Seed.organization()
      const joined = (who: string) =>
        onboarding.record(organizationId, Onboarding.steps.organization.memberJoined, { occurrence: who })
      yield* joined("usr_ada")
      yield* joined("usr_ada")
      yield* joined("usr_grace")
      yield* joined("usr_joan")
      expect(yield* Queue.takeN(grants, 2)).toEqual(
        expect.arrayContaining(
          ["usr_ada", "usr_grace"].map((who) => grant(organizationId, 1_000_000, `onboarding:member.joined:${who}`)),
        ),
      )
      expect(yield* Queue.size(grants)).toBe(0)
    }),
  )

  it.live("gives nothing for a step completed before its reward was configured", () =>
    Effect.gen(function* () {
      const organizationId = yield* Seed.organization()
      const ada = yield* Seed.actor(organizationId, "owner")
      yield* Effect.flatMap(Onboarding.Service, (onboarding) =>
        Effect.all([
          onboarding.record(organizationId, Onboarding.steps.organization.slackConnected),
          ...(["gmail", "granola", "github"] as const).map((slug) =>
            onboarding.recordPersonal(ada, Onboarding.appSteps[slug]),
          ),
        ]),
      ).pipe(Effect.provide(Layer.fresh(Onboarding.layer)))
      const onboarding = yield* Onboarding.Service
      yield* onboarding.record(organizationId, Onboarding.steps.organization.slackConnected)
      yield* onboarding.recordPersonal(ada, Onboarding.appSteps["google-drive"])
      yield* onboarding.record(organizationId, Onboarding.steps.organization.githubConnected)
      expect(yield* Queue.take(grants)).toEqual(grant(organizationId, 3_000_000, "onboarding:github.connected"))
      expect(yield* Queue.size(grants)).toBe(0)
    }),
  )

  testEffect(
    layer({
      "made.up": { microUsd: 1 },
      [Onboarding.steps.personal.memoryImported]: { microUsd: 1 },
      [Onboarding.steps.organization.slackConnected]: { microUsd: 2 },
    }),
  ).live("pays nothing for a step that does not exist or that the app marks itself, and pays the others", () =>
    Effect.gen(function* () {
      const onboarding = yield* Onboarding.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* Seed.actor(organizationId, "owner")
      yield* onboarding.recordPersonal(ada, Onboarding.steps.personal.memoryImported)
      yield* onboarding.record(organizationId, Onboarding.steps.organization.slackConnected)
      expect(yield* Queue.take(grants)).toEqual(grant(organizationId, 2, "onboarding:slack.connected"))
      expect(yield* Queue.size(grants)).toBe(0)
    }),
  )
})
