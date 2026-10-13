export * as AuthEmail from "./auth-email.js"

import type { Mailer } from "@ren/core/mailer"
import { Schema } from "effect"

export const otpExpirySeconds = 60 * 10

export const OTP = Schema.Struct({ type: Schema.Literals(["sign-in", "email-verification"]) })

export const invitation = (to: string, url: URL): Mailer.Email => ({
  to,
  sender: "invitations",
  subject: "You have been invited to join a Ren organization",
  text: `You have been invited to join a Ren organization. Please click on the link below to accept the invitation. ${url.href}`,
})

export const resetPassword = (to: string, url: URL): Mailer.Email => ({
  to,
  subject: "Reset your Ren password",
  text: `Please click on the link below to reset your Ren password. ${url.href}`,
})

export const code = (input: { email: string; otp: string; type: (typeof OTP.Type)["type"] }): Mailer.Email => ({
  to: input.email,
  subject: `${input.otp} is your Ren ${input.type === "sign-in" ? "sign-in" : "verification"} code`,
  text: `Use ${input.otp} to ${input.type === "sign-in" ? "sign in" : "verify your email"} on Ren. The code expires in ${otpExpirySeconds / 60} minutes. If you didn't request it, you can ignore this email.`,
})
