import { FileSystem } from "@ren/core/file-system"
import { UnavailableError } from "@ren/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

const errors = {
  "Primitive.NotFound": Primitive.notFound,
  "Primitive.Forbidden": Primitive.forbidden,
  "Primitive.Invalid": Primitive.invalid,
  "FileSystem.Unavailable": () =>
    Effect.fail(new UnavailableError({ message: "The files did not answer. Try again.", retryAfterMs: 2000 })),
}

export const FilesHandler = HttpApiBuilder.group(Api, "files", (handlers) =>
  Effect.gen(function* () {
    const files = yield* FileSystem.Service
    return handlers
      .handle("files.list", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => files.list(actor, request.query)).pipe(
          Effect.catchTags(errors),
        ),
      )
      .handle("files.read", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => files.read(actor, request.query)).pipe(
          Effect.catchTags(errors),
        ),
      )
      .handle("files.delete", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => files.remove(actor, request.query)).pipe(
          Effect.catchTags(errors),
        ),
      )
  }),
)
