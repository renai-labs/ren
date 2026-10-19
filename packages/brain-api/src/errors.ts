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

export class ModelsUnavailableError extends Schema.TaggedError<ModelsUnavailableError>()(
  "ModelsUnavailableError",
  { message: Schema.String },
  { httpApiStatus: 503 },
) {}

export class HandNotFoundError extends Schema.TaggedError<HandNotFoundError>()(
  "HandNotFoundError",
  { message: Schema.String },
  { httpApiStatus: 404 },
) {}

export class HandUnavailableError extends Schema.TaggedError<HandUnavailableError>()(
  "HandUnavailableError",
  { message: Schema.String },
  { httpApiStatus: 503 },
) {}
