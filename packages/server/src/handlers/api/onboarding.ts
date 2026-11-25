import { Memory } from "@ren/core/memory"
import { Onboarding } from "@ren/core/onboarding"
import { ForbiddenError, NotFoundError } from "@ren/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const OnboardingHandler = HttpApiBuilder.group(Api, "onboarding", (handlers) =>
  Effect.gen(function* () {
    const onboarding = yield* Onboarding.Service
    const memory = yield* Memory.Service
    return handlers
      .handle("onboarding.get", () => Effect.flatMap(Primitive.currentActor, onboarding.get))
      .handle("onboarding.report", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) =>
          onboarding.recordPersonal(actor, request.payload.step).pipe(Effect.andThen(onboarding.get(actor))),
        ),
      )
      .handle("onboarding.importMemory", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) =>
          memory
            .appendRoot(actor, request.payload)
            .pipe(
              Effect.andThen(onboarding.recordPersonal(actor, Onboarding.steps.personal.memoryImported)),
              Effect.andThen(onboarding.get(actor)),
            ),
        ).pipe(
          Effect.catchTags({
            "Primitive.NotFound": (error) => Effect.fail(new NotFoundError({ message: error.message })),
            "Primitive.Forbidden": (error) => Effect.fail(new ForbiddenError({ message: error.message })),
          }),
        ),
      )
      .handle("onboarding.dismiss", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => onboarding.dismiss(actor, request.payload.checklist)),
      )
  }),
)
