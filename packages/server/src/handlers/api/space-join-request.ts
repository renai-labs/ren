import { SpaceJoinRequest } from "@ren/core/space/join-request"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const SpaceJoinRequestHandler = HttpApiBuilder.group(Api, "space-join-request", (handlers) =>
  Effect.gen(function* () {
    const requests = yield* SpaceJoinRequest.Service
    return handlers
      .handle("space-join-request.list", Primitive.list(requests.list))
      .handle("space-join-request.create", Primitive.create(requests.create))
      .handle("space-join-request.approve", Primitive.action(requests.approve))
      .handle("space-join-request.decline", Primitive.action(requests.decline))
      .handle("space-join-request.cancel", Primitive.action(requests.cancel))
  }),
)
