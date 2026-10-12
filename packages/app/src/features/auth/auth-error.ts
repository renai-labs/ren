export * as AuthError from "./auth-error.js"

const messages = {
  EMAIL_NOT_VERIFIED: "Verify your email to continue.",
  INVALID_OTP: "That code didn’t work. Check it and try again.",
  OTP_EXPIRED: "That code has expired. Request a new one.",
  TOO_MANY_ATTEMPTS: "Too many attempts. Request a new code.",
  INVALID_EMAIL_OR_PASSWORD: "Invalid email or password.",
  RATE_LIMITED: "Too many attempts. Please wait and try again.",
  DISPOSABLE_EMAIL: "Please use a permanent email address.",
  UNDELIVERABLE_EMAIL_DOMAIN: "This email domain can’t receive email. Check the address and try again.",
  ALIAS_EMAIL: "An account already exists for this inbox. Sign in instead.",
}

type Code = keyof typeof messages | "UNKNOWN"

export interface Failure {
  readonly code: Code
  readonly message: string
}

const aliases: Record<string, keyof typeof messages> = {
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "ALIAS_EMAIL",
}

const unavailable = "The authentication service is unavailable. Please try again."
const transportMessages = new Set([
  "Fetch related error. Captured by catchAllError option. See error property for more details.",
  "Failed to fetch",
  "Fetch Error",
])

const isKnown = (code: string): code is keyof typeof messages => Object.hasOwn(messages, code)

export function describe(error: {
  readonly code?: string
  readonly message?: string
  readonly status: number
  readonly statusText: string
}): Failure {
  const code = error.status === 429 ? "RATE_LIMITED" : (aliases[error.code ?? ""] ?? error.code ?? "")
  if (isKnown(code)) return { code, message: messages[code] }
  if (error.status >= 500) return { code: "UNKNOWN", message: unavailable }
  const detail = [error.message?.trim() ?? "", error.statusText.trim()].find(
    (text) => text !== "" && !transportMessages.has(text),
  )
  return { code: "UNKNOWN", message: detail ?? unavailable }
}
