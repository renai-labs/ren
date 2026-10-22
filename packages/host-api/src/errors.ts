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

export class StaleUploadError extends Schema.TaggedError<StaleUploadError>()(
  "StaleUploadError",
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

export class EnvironmentNotFoundError extends Schema.TaggedError<EnvironmentNotFoundError>()(
  "EnvironmentNotFoundError",
  { message: Schema.String },
  { httpApiStatus: 404 },
) {}

export class EnvironmentUnavailableError extends Schema.TaggedError<EnvironmentUnavailableError>()(
  "EnvironmentUnavailableError",
  { message: Schema.String },
  { httpApiStatus: 503 },
) {}

export class SyncUnavailableError extends Schema.TaggedError<SyncUnavailableError>()(
  "SyncUnavailableError",
  { message: Schema.String },
  { httpApiStatus: 503 },
) {}

export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
  "UnauthorizedError",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

export class GenerationRetiredError extends Schema.TaggedError<GenerationRetiredError>()(
  "GenerationRetiredError",
  { message: Schema.String },
  { httpApiStatus: 403 },
) {}
