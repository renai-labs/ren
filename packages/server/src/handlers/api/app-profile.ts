import { AppProfiles } from "@ren/core/app/profiles"
import { CredentialRequirements } from "@ren/core/credential-requirements"
import { ForbiddenError, NotFoundError } from "@ren/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const AppProfileHandler = HttpApiBuilder.group(Api, "app-profile", (handlers) =>
  Effect.gen(function* () {
    const profiles = yield* AppProfiles.Service
    return handlers
      .handle("app-profile.list", Primitive.list(profiles.list))
      .handle("app-profile.get", Primitive.get(profiles.get))
      .handle("app-profile.create", Primitive.create(profiles.create))
      .handle("app-profile.update", Primitive.update(profiles.update))
      .handle("app-profile.access", Primitive.action(profiles.access))
      .handle("app-profile.link", Primitive.action(profiles.link))
      .handle("app-profile.promote", Primitive.action(profiles.promote))
  }),
)

export const AppProfileReachHandler = HttpApiBuilder.group(Api, "app-profile-reach", (handlers) =>
  Effect.gen(function* () {
    const profiles = yield* AppProfiles.Service
    const requirements = yield* CredentialRequirements.Service
    return handlers
      .handle("app-profile.delete", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => profiles.delete(actor, request.params.id)).pipe(
          Effect.catchTags({
            "Primitive.NotFound": (error) => Effect.fail(new NotFoundError({ message: error.message })),
            "Primitive.Forbidden": (error) => Effect.fail(new ForbiddenError({ message: error.message })),
          }),
        ),
      )
      .handle("session.profiles", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => requirements.forSession(actor, request.params.id)).pipe(
          Effect.catchTag("Primitive.NotFound", (error) => Effect.fail(new NotFoundError({ message: error.message }))),
        ),
      )
      .handle("space.profiles", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => requirements.forSpace(actor, request.params.id)).pipe(
          Effect.catchTag("Primitive.NotFound", (error) => Effect.fail(new NotFoundError({ message: error.message }))),
        ),
      )
  }),
)
