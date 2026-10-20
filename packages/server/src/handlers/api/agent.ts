import { Agent } from "@ren/core/agent"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const AgentHandler = HttpApiBuilder.group(Api, "agent", (handlers) =>
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    return handlers
      .handle("agent.list", Primitive.list(agents.list))
      .handle("agent.get", Primitive.get(agents.get))
      .handle("agent.create", Primitive.create(agents.create))
      .handle("agent.update", Primitive.update(agents.update))
      .handle("agent.archive", Primitive.archive(agents.archive))
      .handle("agent.transferOwnership", Primitive.action(agents.transferOwnership))
  }),
)
