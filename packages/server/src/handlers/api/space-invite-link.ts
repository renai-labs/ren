import { SpaceInviteLink } from "@ren/core/space/invite-link"
import { CurrentUser } from "@ren/protocol/middleware/authentication"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const SpaceInviteLinkHandler = HttpApiBuilder.group(Api, "space-invite-link", (handlers) =>
  Effect.gen(function* () {
    const links = yield* SpaceInviteLink.Service
    return handlers
      .handle("space-invite-link.get", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => links.get(actor, request.params.id)).pipe(
          Effect.catchTags({ "Primitive.NotFound": Primitive.notFound, "Primitive.Forbidden": Primitive.forbidden }),
        ),
      )
      .handle("space-invite-link.reset", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => links.reset(actor, request.params.id)).pipe(
          Effect.catchTags({ "Primitive.NotFound": Primitive.notFound, "Primitive.Forbidden": Primitive.forbidden }),
        ),
      )
  }),
)

export const JoinLinkHandler = HttpApiBuilder.group(Api, "join-link", (handlers) =>
  Effect.gen(function* () {
    const links = yield* SpaceInviteLink.Service
    return handlers
      .handle("join-link.preview", (request) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          return yield* links.preview(user.id, request.params.token)
        }),
      )
      .handle("join-link.accept", (request) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          return yield* links.accept(user.id, request.params.token)
        }).pipe(
          Effect.catchTags({ "Primitive.NotFound": Primitive.notFound, "Primitive.Forbidden": Primitive.forbidden }),
        ),
      )
  }),
)
