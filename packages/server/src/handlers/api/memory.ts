import { Memory } from "@ren/core/memory"
import type { Primitive as CorePrimitive } from "@ren/core/primitive"
import { ForbiddenError, InvalidRequestError, NotFoundError } from "@ren/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

const notFound = (error: CorePrimitive.NotFound) => Effect.fail(new NotFoundError({ message: error.message }))

const forbidden = (error: CorePrimitive.Forbidden) => Effect.fail(new ForbiddenError({ message: error.message }))

const invalid = (error: CorePrimitive.Invalid) =>
  Effect.fail(new InvalidRequestError({ message: error.message, ...(error.field && { field: error.field }) }))

export const MemoryHandler = HttpApiBuilder.group(Api, "memory", (handlers) =>
  Effect.gen(function* () {
    const memory = yield* Memory.Service
    return handlers
      .handle("memory.list", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => memory.list(actor, request.query)).pipe(
          Effect.catchTag("Primitive.NotFound", notFound),
        ),
      )
      .handle("memory.read", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => memory.read(actor, request.query)).pipe(
          Effect.catchTag("Primitive.NotFound", notFound),
        ),
      )
      .handle("memory.write", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => memory.write(actor, request.payload)).pipe(
          Effect.catchTags({
            "Primitive.NotFound": notFound,
            "Primitive.Forbidden": forbidden,
            "Primitive.Invalid": invalid,
          }),
        ),
      )
      .handle("memory.edit", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => memory.edit(actor, request.payload)).pipe(
          Effect.catchTags({
            "Primitive.NotFound": notFound,
            "Primitive.Forbidden": forbidden,
            "Primitive.Invalid": invalid,
          }),
        ),
      )
      .handle("memory.delete", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => memory.delete(actor, request.query)).pipe(
          Effect.catchTags({ "Primitive.NotFound": notFound, "Primitive.Forbidden": forbidden }),
        ),
      )
  }),
)
