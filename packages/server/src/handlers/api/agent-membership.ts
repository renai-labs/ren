import { AgentMembership } from "@ren/core/agent/membership"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const AgentMembershipHandler = HttpApiBuilder.group(Api, "agent-membership", (handlers) =>
  Effect.gen(function* () {
    const memberships = yield* AgentMembership.Service
    return handlers
      .handle("agent-membership.list", Primitive.list(memberships.list))
      .handle("agent-membership.create", Primitive.create(memberships.create))
      .handle("agent-membership.archive", Primitive.archive(memberships.archive))
  }),
)
