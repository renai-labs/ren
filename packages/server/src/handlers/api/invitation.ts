import { Invitation } from "@ren/core/invitation"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"

export const InvitationHandler = HttpApiBuilder.group(Api, "invitation", (handlers) =>
  Effect.gen(function* () {
    const invitations = yield* Invitation.Service
    return handlers.handle("invitation.preview", (request) => invitations.preview(request.params.id))
  }),
)
