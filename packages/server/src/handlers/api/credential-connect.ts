import { CredentialRequirements } from "@ren/core/credential-requirements"
import { NotFoundError } from "@ren/protocol/errors"
import { OAuth } from "@ren/core/oauth"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const CredentialConnectHandler = HttpApiBuilder.group(Api, "credential-connect", (handlers) =>
  Effect.gen(function* () {
    const oauth = yield* OAuth.Service
    const requirements = yield* CredentialRequirements.Service
    return handlers
      .handle("credential.connect", Primitive.create(oauth.connect))
      .handle("credential.requirements", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => requirements.forApp(actor, request.query)).pipe(
          Effect.catchTag("Primitive.NotFound", (error) => Effect.fail(new NotFoundError({ message: error.message }))),
        ),
      )
  }),
)
