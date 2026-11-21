export * as ApiError from "./api-error.js"

const statusByTag: Record<string, number> = {
  InvalidRequestError: 400,
  UnauthorizedError: 401,
  ForbiddenError: 403,
  NotFoundError: 404,
  ConflictError: 409,
  TooLargeError: 413,
  UnavailableError: 503,
}

export function status(error: unknown) {
  if (!(error instanceof Error)) return 500
  const declared = statusByTag[error.name]
  if (declared) return declared
  const match = /UnexpectedStatus: (\d{3})/u.exec(error.message)
  return match ? Number(match.at(1)) : 500
}
