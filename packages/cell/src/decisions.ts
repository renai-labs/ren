export * as Decisions from "./decisions.js"

import { OpenAiClient, OpenAiSchema } from "@effect/ai-openai"
import type { ModelTypes } from "@ren/schema/model-types"
import { Cause, Effect, Redacted, Schema, Struct } from "effect"
import { ModelHttp } from "./model-http.js"

export const Parameters = OpenAiSchema.CreateDecisionsRequest.mapFields(Struct.omit(["model"]))
export const Output = OpenAiSchema.CreateDecisionsResponse

class Failure extends Schema.TaggedError<Failure>()("Decisions.Failure", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

interface Request extends OpenAiSchema.CreateDecisionsRequest {
  readonly headers: Readonly<Record<string, string>>
}

export const decide = Effect.fn("Decisions.decide")(
  function* (provider: ModelTypes.Provider, key: Effect.Effect<Redacted.Redacted>, request: Request) {
    const client = yield* OpenAiClient.make(ModelHttp.options(provider, key, request.headers))
    return yield* client.createDecisions(Struct.omit(request, ["headers"]))
  },
  Effect.mapError((cause) => new Failure({ message: Cause.pretty(Cause.fail(cause)), cause })),
)
