export * as AuthForm from "./auth-form.js"

import type { Auth } from "@ren/schema/auth"
import type { AuthError } from "./auth-error.js"

export const title = "Welcome to Ren"

export const description = "Self-improving software"

export const signUpAgreement = "By creating an account, you agree to the "

export const providers: ReadonlyArray<Auth.SignInProvider> = ["google", "github", "slack"]

const providerTitles: Readonly<Record<Auth.SignInProvider, string>> = {
  google: "Google",
  github: "GitHub",
  slack: "Slack",
}

export const providerTitle = (provider: Auth.SignInProvider) => providerTitles[provider]

export const minimumPasswordLength = 8

export const passwordHint = `At least ${minimumPasswordLength} characters`

export const codeLength = 6

export const resendSeconds = 30

export const emailError = (email: string) => (email.includes("@") ? "" : "Enter a valid email address.")

export const nameError = (name: string) => (name.trim() ? "" : "Enter your name.")

export const passwordError = (password: string) =>
  password.length >= minimumPasswordLength ? "" : `Use at least ${minimumPasswordLength} characters.`

const emailRejections = new Set<AuthError.Failure["code"]>([
  "DISPOSABLE_EMAIL",
  "UNDELIVERABLE_EMAIL_DOMAIN",
  "ALIAS_EMAIL",
])

export const isEmailRejection = (code: AuthError.Failure["code"]) => emailRejections.has(code)
