import { Insights } from "@ren/core/insights"
import { NotFoundError } from "@ren/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const InsightsHandler = HttpApiBuilder.group(Api, "insights", (handlers) =>
  Effect.gen(function* () {
    const insights = yield* Insights.Service
    return handlers.handle("insights.query", (request) =>
      Effect.flatMap(Primitive.currentActor, (actor) => insights.query(actor, request.query)).pipe(
        Effect.catchTag("Primitive.NotFound", (error) => Effect.fail(new NotFoundError({ message: error.message }))),
      ),
    )
  }),
)
