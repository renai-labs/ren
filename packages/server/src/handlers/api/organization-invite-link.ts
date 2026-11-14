import { OrganizationInviteLink } from "@ren/core/organization-invite-link"
import { CurrentUser } from "@ren/protocol/middleware/authentication"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Auth } from "../../auth.js"
import { Primitive } from "../../primitive.js"

export const OrganizationInviteLinkHandler = HttpApiBuilder.group(Api, "organization-invite-link", (handlers) =>
  Effect.gen(function* () {
    const links = yield* OrganizationInviteLink.Service
    return handlers
      .handle("organization-invite-link.create", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => links.create(actor, request.payload)).pipe(
          Effect.catchTags({ "Primitive.Forbidden": Primitive.forbidden, "Primitive.Invalid": Primitive.invalid }),
        ),
      )
      .handle("organization-invite-link.list", () =>
        Effect.flatMap(Primitive.currentActor, (actor) => links.list(actor)).pipe(
          Effect.map((items) => ({ items })),
          Effect.catchTag("Primitive.Forbidden", Primitive.forbidden),
        ),
      )
      .handle("organization-invite-link.revoke", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => links.revoke(actor, request.params.id)).pipe(
          Effect.catchTags({ "Primitive.NotFound": Primitive.notFound, "Primitive.Forbidden": Primitive.forbidden }),
        ),
      )
  }),
)

export const OrganizationJoinLinkHandler = HttpApiBuilder.group(Api, "organization-join-link", (handlers) =>
  Effect.gen(function* () {
    const links = yield* OrganizationInviteLink.Service
    const auth = yield* Auth.Service
    return handlers
      .handle("organization-join-link.preview", (request) => links.preview(request.params.token))
      .handle("organization-join-link.accept", (request) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          return yield* links.accept(user.id, request.params.token, (organizationId) =>
            auth.addMember({ userId: user.id, organizationId }),
          )
        }).pipe(Effect.catchTag("Primitive.NotFound", Primitive.notFound)),
      )
  }),
)
