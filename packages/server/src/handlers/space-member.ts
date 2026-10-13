import { SpaceMember } from "@ren/core/space/member"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api.js"
import { Primitive } from "../primitive.js"

export const SpaceMemberHandler = HttpApiBuilder.group(Api, "space-member", (handlers) =>
  Effect.gen(function* () {
    const members = yield* SpaceMember.Service
    return handlers
      .handle("space-member.list", Primitive.list(members.list))
      .handle("space-member.create", Primitive.create(members.create))
      .handle("space-member.archive", Primitive.archive(members.archive))
  }),
)
