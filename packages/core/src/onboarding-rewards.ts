export * as OnboardingRewards from "./onboarding-rewards.js"

import { Auth } from "@ren/schema/auth"
import { Config, Effect, Layer, Schema } from "effect"
import { Billing } from "./billing.js"
import { DurableRunner } from "./durable-runner.js"
import { Onboarding } from "./onboarding.js"

const Reward = Schema.Struct({ microUsd: Schema.Int.check(Schema.isGreaterThan(0)) }).annotate({
  identifier: "OnboardingRewards.Reward",
})

const Rules = Schema.fromJsonString(Schema.Record(Onboarding.Step, Schema.optionalKey(Reward))).annotate({
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

export const layer = Layer.effect(
  Onboarding.Listener,
  Effect.gen(function* () {
    const rules = yield* Schema.decodeEffect(Rules, { onExcessProperty: "error" })(
      yield* Config.String("ONBOARDING_REWARDS").pipe(Config.withDefault("{}")),
    ).pipe(Effect.orDie)
    const billing = yield* Billing.Service
    const pay = yield* DurableRunner.supervised(GrantRun, (payload) =>
      billing.grant(payload.organizationId, { microUsd: payload.microUsd, key: payload.key }),
    )
    return {
      completed: Effect.fn("OnboardingRewards.completed")(function* (
        organizationId: Auth.OrganizationID,
        userId: Auth.UserID | null,
        step: Onboarding.Step,
      ) {
        const reward = rules[step]
        if (reward)
          yield* pay({
            organizationId,
            key: userId ? `onboarding:${step}:${userId}` : `onboarding:${step}`,
            microUsd: reward.microUsd,
          })
      }),
    } satisfies Onboarding.ListenerInterface
  }),
)
