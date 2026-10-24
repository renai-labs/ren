import { Credentials } from "@ren/core/credentials"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const CredentialHandler = HttpApiBuilder.group(Api, "credential", (handlers) =>
  Effect.gen(function* () {
    const credentials = yield* Credentials.Service
    return handlers
      .handle("credential.list", Primitive.list(credentials.list))
      .handle("credential.get", Primitive.get(credentials.get))
      .handle("credential.create", Primitive.create(credentials.create))
      .handle("credential.update", Primitive.update(credentials.update))
      .handle("credential.rotate", Primitive.update(credentials.rotate))
      .handle("credential.move", Primitive.action(credentials.move))
      .handle("credential.copy", Primitive.action(credentials.copy))
      .handle("credential.remove", Primitive.action(credentials.remove))
  }),
)
