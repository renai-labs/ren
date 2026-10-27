import { Drives } from "@ren/core/drives"
import { UnavailableError } from "@ren/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

const errors = {
  "Primitive.NotFound": Primitive.notFound,
  "Primitive.Forbidden": Primitive.forbidden,
  "Drives.Unavailable": () =>
    Effect.fail(new UnavailableError({ message: "The drive did not answer. Try again.", retryAfterMs: 2000 })),
}

export const DriveHandler = HttpApiBuilder.group(Api, "drive", (handlers) =>
  Effect.gen(function* () {
    const drives = yield* Drives.Service
    return handlers
      .handle("drive.list", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => drives.list(actor, request.query)).pipe(
          Effect.catchTags({ ...errors, "Primitive.Invalid": Primitive.invalid }),
        ),
      )
      .handle("drive.startUpload", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => drives.startUpload(actor, request.payload)).pipe(
          Effect.catchTags({ ...errors, "Primitive.Invalid": Primitive.invalid }),
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
