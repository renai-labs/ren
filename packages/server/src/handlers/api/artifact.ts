import { Artifacts } from "@ren/core/artifacts"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const ArtifactHandler = HttpApiBuilder.group(Api, "artifact", (handlers) =>
  Effect.gen(function* () {
    const artifacts = yield* Artifacts.Service
    return handlers
      .handle("artifact.list", Primitive.list(artifacts.list))
      .handle("artifact.get", Primitive.get(artifacts.get))
      .handle("artifact.archive", Primitive.archive(artifacts.archive))
  }),
)
