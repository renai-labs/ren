import { Drives } from "@ren/core/drives"
import type { Primitive as CorePrimitive } from "@ren/core/primitive"
import { ForbiddenError, InvalidRequestError, NotFoundError, UnavailableError } from "@ren/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

const errors = {
  "Primitive.NotFound": (error: CorePrimitive.NotFound) => Effect.fail(new NotFoundError({ message: error.message })),
  "Primitive.Forbidden": (error: CorePrimitive.Forbidden) =>
    Effect.fail(new ForbiddenError({ message: error.message })),
  "Drives.Unavailable": () =>
    Effect.fail(new UnavailableError({ message: "The drive did not answer. Try again.", retryAfterMs: 2000 })),
}

const invalid = (error: CorePrimitive.Invalid) =>
  Effect.fail(new InvalidRequestError({ message: error.message, ...(error.field && { field: error.field }) }))

export const DriveHandler = HttpApiBuilder.group(Api, "drive", (handlers) =>
  Effect.gen(function* () {
    const drives = yield* Drives.Service
    return handlers
      .handle("drive.list", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => drives.list(actor, request.query)).pipe(
          Effect.catchTags({ ...errors, "Primitive.Invalid": invalid }),
        ),
      )
      .handle("drive.startUpload", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => drives.startUpload(actor, request.payload)).pipe(
          Effect.catchTags({ ...errors, "Primitive.Invalid": invalid }),
        ),
      )
      .handle("drive.download", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => drives.download(actor, request.query)).pipe(
          Effect.catchTags(errors),
        ),
      )
      .handle("drive.delete", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => drives.delete(actor, request.query)).pipe(
          Effect.catchTags(errors),
        ),
      )
  }),
)
