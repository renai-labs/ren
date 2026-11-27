export * as OnboardingRewards from "./onboarding-rewards.js"

import { Auth } from "@ren/schema/auth"
import { Config, Effect, Layer, Record, Schema } from "effect"
import { Billing } from "./billing.js"
import { DurableRunner } from "./durable-runner.js"
import { Onboarding } from "./onboarding.js"

const Reward = Schema.Struct({
  microUsd: Schema.Int.check(Schema.isGreaterThan(0)),
  upTo: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
}).annotate({ identifier: "OnboardingRewards.Reward" })

const Rules = Schema.fromJsonString(Schema.Record(Schema.String, Reward)).annotate({
  identifier: "OnboardingRewards.Rules",
})

const GrantRun = DurableRunner.make("OnboardingReward", {
  payload: Schema.Struct({
    organizationId: Auth.OrganizationID,
    key: Schema.String,
    microUsd: Schema.Int,
  }),
  idempotencyKey: (grant) => `onboarding-reward:${grant.organizationId}:${grant.key}`,
})

const payable = (step: string) => Schema.is(Onboarding.Step)(step) && !Schema.is(Onboarding.ReportedStep)(step)

const rewards = Layer.effect(
  Onboarding.Rewards,
  Effect.gen(function* () {
    const rules = yield* Schema.decodeEffect(Rules)(
      yield* Config.String("ONBOARDING_REWARDS").pipe(Config.withDefault("{}")),
    ).pipe(Effect.orDie)
    const ignored = Object.keys(rules).filter((step) => !payable(step))
    if (ignored.length > 0)
      yield* Effect.logWarning(
        "ONBOARDING_REWARDS names steps that do not exist or that the app marks itself; they pay nothing",
      ).pipe(Effect.annotateLogs({ steps: ignored }))
    return Record.filter(rules, (_, step) => payable(step))
  }),
)

export const layer = Layer.effect(
  Onboarding.Listener,
  Effect.gen(function* () {
    const rules = yield* Onboarding.Rewards
    const billing = yield* Billing.Service
    const pay = yield* DurableRunner.supervised(GrantRun, (payload) =>
      billing.grant(payload.organizationId, { microUsd: payload.microUsd, key: payload.key }),
    )
    return {
      completed: Effect.fn("OnboardingRewards.completed")(function* (completion: Onboarding.Completion) {
        const reward = rules[completion.step]
        if (!reward) return
        const occurrences = completion.recorded.filter((key) => key.startsWith(`${completion.step}:`)).length
        if (completion.occurrence && occurrences > (reward.upTo ?? 1)) return
        yield* pay({
          organizationId: completion.organizationId,
          key: ["onboarding", completion.step, completion.occurrence, completion.userId].filter(Boolean).join(":"),
          microUsd: reward.microUsd,
        })
      }),
    } satisfies Onboarding.ListenerInterface
  }),
).pipe(Layer.provideMerge(rewards))
