const statusByTag: Record<string, number> = {
  InvalidRequestError: 400,
  UnauthorizedError: 401,
  ForbiddenError: 403,
  NotFoundError: 404,
  ConflictError: 409,
  TooLargeError: 413,
  UnavailableError: 503,
}

export function errorStatus(error: unknown) {
  if (!(error instanceof Error)) return 500
  const declared = statusByTag[error.name]
  if (declared) return declared
  const match = /UnexpectedStatus: (\d{3})/u.exec(error.message)
  return match ? Number(match[1]) : 500
}

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error && error.message && !error.message.startsWith("UnexpectedStatus")
    ? error.message
    : fallback
}
