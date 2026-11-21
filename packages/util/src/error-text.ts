export * as ErrorText from "./error-text.js"

const bareTag = /^[A-Z][A-Za-z]+$/u

export function of(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error &&
    error.message &&
    !error.message.startsWith("UnexpectedStatus") &&
    !bareTag.test(error.message)
    ? error.message
    : fallback
}
