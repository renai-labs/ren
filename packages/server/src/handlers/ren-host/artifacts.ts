import { Artifacts } from "@ren/core/artifacts"
import {
  ArtifactConflictError,
  ArtifactFailedError,
  ArtifactInvalidError,
  ArtifactNotFoundError,
} from "@ren/host-api/errors"
import { CurrentHost, RenHostApi } from "@ren/host-api/ren-host-api"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

export const HostArtifactsHandler = HttpApiBuilder.group(RenHostApi, "artifacts", (handlers) =>
  Effect.gen(function* () {
    const artifacts = yield* Artifacts.Service
    return handlers
      .handle("artifacts.upload", (request) =>
        Effect.flatMap(CurrentHost, (host) => artifacts.upload(host, request.params.id)).pipe(
          Effect.catchTags({
            "Primitive.Conflict": (error) => Effect.fail(new ArtifactConflictError({ message: error.message })),
            "Artifacts.Failed": (error) => Effect.fail(new ArtifactFailedError({ message: error.message })),
          }),
        ),
      )
      .handle("artifacts.status", (request) =>
        Effect.flatMap(CurrentHost, (host) =>
          artifacts.status(host, request.params.id, request.params.deploymentId),
        ).pipe(
          Effect.catchTag("Primitive.NotFound", (error) =>
            Effect.fail(new ArtifactNotFoundError({ message: error.message })),
          ),
        ),
      )
      .handle("artifacts.deploy", (request) =>
        Effect.flatMap(CurrentHost, (host) => artifacts.deploy(host, request.params.id, request.payload)).pipe(
          Effect.catchTags({
            "Primitive.Conflict": (error) => Effect.fail(new ArtifactConflictError({ message: error.message })),
            "Primitive.Invalid": (error) => Effect.fail(new ArtifactInvalidError({ message: error.message })),
          }),
        ),
      )
      .handle("artifacts.read", (request) =>
        Effect.flatMap(CurrentHost, (host) => artifacts.read(host, request.params.id)).pipe(
          Effect.catchTag("Primitive.NotFound", (error) =>
            Effect.fail(new ArtifactNotFoundError({ message: error.message })),
          ),
        ),
      )
      .handle("artifacts.download", (request) =>
        Effect.flatMap(CurrentHost, (host) => artifacts.download(host, request.params.id)).pipe(
          Effect.catchTags({
            "Primitive.NotFound": (error) => Effect.fail(new ArtifactNotFoundError({ message: error.message })),
            "Artifacts.Failed": (error) => Effect.fail(new ArtifactFailedError({ message: error.message })),
          }),
        ),
      )
      .handle("artifacts.stop", (request) =>
        Effect.flatMap(CurrentHost, (host) => artifacts.stop(host, request.params.id, request.query)).pipe(
          Effect.catchTags({
            "Primitive.NotFound": (error) => Effect.fail(new ArtifactNotFoundError({ message: error.message })),
            "Primitive.Conflict": (error) => Effect.fail(new ArtifactConflictError({ message: error.message })),
            "Primitive.Invalid": (error) => Effect.fail(new ArtifactInvalidError({ message: error.message })),
          }),
        ),
      )
  }),
)
