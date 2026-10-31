import { InfraSpecs } from "@ren/core/infra-specs"
import { ForbiddenError } from "@ren/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

const forbidden = (error: { readonly message: string }) => Effect.fail(new ForbiddenError({ message: error.message }))

export const InfraHandler = HttpApiBuilder.group(Api, "infra", (handlers) =>
  Effect.gen(function* () {
    const infra = yield* InfraSpecs.Service
    return handlers
      .handle("infra.pull", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => infra.pull(actor, request.payload)).pipe(
          Effect.catchTag("Primitive.Forbidden", forbidden),
          Effect.catchTag("Primitive.Invalid", Primitive.invalid),
        ),
      )
      .handle("infra.plan", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => infra.plan(actor, request.payload)).pipe(
          Effect.catchTag("Primitive.Forbidden", forbidden),
        ),
      )
      .handle("infra.apply", Primitive.create(infra.apply))
  }),
)
