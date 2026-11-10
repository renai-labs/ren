export * as ModelTypes from "./model-types.js"

import { Schema } from "effect"
import { Models } from "./models.js"

export const Type = Schema.Literals([
  "image_generation",
  "audio_transcription",
  "decisions",
  "audio_speech",
  "realtime",
  "video_generation",
  "search",
]).annotate({
  identifier: "ModelTypes.Type",
})
export type Type = typeof Type.Type

export const modelType = {
  image_generation: "image",
  audio_transcription: "transcription",
  decisions: "decision",
  audio_speech: "speech",
  realtime: "realtime",
  video_generation: "video",
} satisfies Record<Exclude<Type, "search">, Models.Type>

export interface ModelRef extends Schema.Schema.Type<typeof ModelRef> {}
export const ModelRef = Schema.Struct({
  providerId: Schema.NonEmptyString.annotate({ description: "The endpoint ID." }),
  modelId: Schema.NonEmptyString.annotate({
    description: "The model ID on the endpoint, or for search the ID of a search provider the endpoint serves.",
  }),
}).annotate({ identifier: "ModelTypes.ModelRef" })

export const Defaults = Schema.Record(Type, Schema.optionalKey(ModelRef)).annotate({
  identifier: "ModelTypes.Defaults",
})
export type Defaults = typeof Defaults.Type
