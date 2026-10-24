import { AppRelease } from "@ren/core/app/release"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const AppReleaseHandler = HttpApiBuilder.group(Api, "app-release", (handlers) =>
  Effect.gen(function* () {
    const releases = yield* AppRelease.Service
    return handlers
      .handle("app-release.list", Primitive.list(releases.list))
      .handle("app-release.get", Primitive.get(releases.get))
      .handle("app-release.create", Primitive.create(releases.create))
  }),
)
