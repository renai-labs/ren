export * as Transcription from "./transcription.js"

import { Generated, OpenAiClientGenerated } from "@effect/ai-openai"
import type { ModelTypes } from "@ren/schema/model-types"
import { Cause, Effect, Redacted, Schema, Struct } from "effect"
import { ModelHttp } from "./model-http.js"

export const Parameters = Generated.CreateTranscriptionRequestMultipart.mapFields(
  Struct.pick(["language", "prompt", "temperature"]),
)
export const Output = Generated.CreateTranscription200

class Failure extends Schema.TaggedError<Failure>()("Transcription.Failure", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

interface Request extends Schema.Schema.Type<typeof Parameters> {
  readonly model: string
  readonly file: File
  readonly headers: Readonly<Record<string, string>>
}

export const transcribe = Effect.fn("Transcription.transcribe")(
  function* (provider: ModelTypes.Provider, key: Effect.Effect<Redacted.Redacted>, request: Request) {
    const client = yield* OpenAiClientGenerated.make(ModelHttp.options(provider, key, request.headers))
    return yield* client.createTranscription({
      payload: { ...Struct.omit(request, ["headers"]), response_format: "json" },
    })
  },
  Effect.mapError((cause) => new Failure({ message: Cause.pretty(Cause.fail(cause)), cause })),
)
