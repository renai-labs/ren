import { Schema } from "effect"

export class ForbiddenError extends Schema.TaggedError<ForbiddenError>()(
  "ForbiddenError",
  { message: Schema.String },
  { httpApiStatus: 403 },
) {}

export class BrainRejectedError extends Schema.TaggedError<BrainRejectedError>()(
  "BrainRejectedError",
  { message: Schema.String },
  { httpApiStatus: 422 },
) {}

export class SessionNotStartedError extends Schema.TaggedError<SessionNotStartedError>()(
  "SessionNotStartedError",
  { message: Schema.String },
  { httpApiStatus: 409 },
) {}

export class ModelsNotConfiguredError extends Schema.TaggedError<ModelsNotConfiguredError>()(
  "ModelsNotConfiguredError",
  { message: Schema.String },
  { httpApiStatus: 409 },
) {}
