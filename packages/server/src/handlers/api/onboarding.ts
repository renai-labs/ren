import { Onboarding } from "@ren/core/onboarding"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const OnboardingHandler = HttpApiBuilder.group(Api, "onboarding", (handlers) =>
  Effect.gen(function* () {
    const onboarding = yield* Onboarding.Service
    return handlers
      .handle("onboarding.get", () => Effect.flatMap(Primitive.currentActor, onboarding.get))
      .handle("onboarding.complete", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) =>
          Effect.andThen(onboarding.recordPersonal(actor, request.payload.step), onboarding.get(actor)),
        ),
      )
      .handle("onboarding.dismiss", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => onboarding.dismiss(actor, request.payload.checklist)),
      )
  }),
)
