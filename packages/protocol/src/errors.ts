import { ErrorReporter, Schema } from "effect"

export class InvalidRequestError extends Schema.TaggedError<InvalidRequestError>()(
  "InvalidRequestError",
  {
    message: Schema.String,
    field: Schema.optional(Schema.String),
  },
  { httpApiStatus: 400 },
) {
  override readonly [ErrorReporter.ignore] = true
}

export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
  "UnauthorizedError",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {
  override readonly [ErrorReporter.ignore] = true
}

export class ForbiddenError extends Schema.TaggedError<ForbiddenError>()(
  "ForbiddenError",
  { message: Schema.String },
  { httpApiStatus: 403 },
) {
  override readonly [ErrorReporter.ignore] = true
}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()(
  "NotFoundError",
  {
    message: Schema.String,
    resource: Schema.optional(Schema.String),
  },
  { httpApiStatus: 404 },
) {
  override readonly [ErrorReporter.ignore] = true
}

export class ConflictError extends Schema.TaggedError<ConflictError>()(
  "ConflictError",
  {
    message: Schema.String,
    resource: Schema.optional(Schema.String),
  },
  { httpApiStatus: 409 },
) {
  override readonly [ErrorReporter.ignore] = true
}

export class TooLargeError extends Schema.TaggedError<TooLargeError>()(
  "TooLargeError",
  { message: Schema.String },
  { httpApiStatus: 413 },
) {
  override readonly [ErrorReporter.ignore] = true
}

export class UnavailableError extends Schema.TaggedError<UnavailableError>()(
  "UnavailableError",
  {
    message: Schema.String,
    retryAfterMs: Schema.Int.annotate({ description: "Ask again after this many milliseconds." }),
  },
  { httpApiStatus: 503 },
) {
  override readonly [ErrorReporter.ignore] = true
}

export class UnknownError extends Schema.TaggedError<UnknownError>()(
  "UnknownError",
  {
    message: Schema.String,
    ref: Schema.optional(Schema.String),
  },
  { httpApiStatus: 500 },
) {
  override readonly [ErrorReporter.severity] = "Error"
}
