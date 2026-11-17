import { Feedback } from "@ren/core/feedback"
import { UnavailableError } from "@ren/protocol/errors"
import { Effect, Option } from "effect"
import { HttpServerRequest } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { McpCaller } from "../../middleware/authentication.js"
import { Primitive } from "../../primitive.js"

export const FeedbackHandler = HttpApiBuilder.group(Api, "feedback", (handlers) =>
  Effect.gen(function* () {
    const feedback = yield* Feedback.Service
    return handlers.handle("feedback.report", (request) =>
      Effect.gen(function* () {
        const actor = yield* Primitive.currentActor
        const mcp = Option.isSome(yield* Effect.serviceOption(McpCaller))
        const client = ((yield* HttpServerRequest.HttpServerRequest).headers["user-agent"] ?? "").startsWith("ren2/")
          ? "cli"
          : "api"
        yield* feedback.report({
          actor,
          via: mcp ? "mcp" : client,
          message: request.payload.message,
        })
      }).pipe(
        Effect.catchTag("Feedback.Unavailable", (error) =>
          Effect.fail(new UnavailableError({ message: error.message, retryAfterMs: 60_000 })),
        ),
      ),
    )
  }),
)
