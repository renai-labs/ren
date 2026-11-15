import { Insights } from "@ren/core/insights"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const InsightsHandler = HttpApiBuilder.group(Api, "insights", (handlers) =>
  Effect.gen(function* () {
    const insights = yield* Insights.Service
    return handlers.handle("insights.query", (request) =>
      Effect.flatMap(Primitive.currentActor, (actor) => insights.query(actor, request.query)).pipe(
        Effect.catchTags({ "Primitive.NotFound": Primitive.notFound, "Primitive.Forbidden": Primitive.forbidden }),
      ),
    )
  }),
)
