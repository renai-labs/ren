export * as Errors from "./errors.js"

import { Schema } from "effect"

export class GenerationError extends Schema.TaggedError<GenerationError>()("GenerationError", {
  reason: Schema.String,
}) {
  override get message() {
    return this.reason
  }
}
