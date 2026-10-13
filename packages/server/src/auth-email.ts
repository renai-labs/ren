export * as AuthEmail from "./auth-email.js"

import type { Mailer } from "@ren/core/mailer"

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

export const code = (input: { email: string; otp: string; type: "sign-in" | "email-verification" }): Mailer.Email => ({
  to: input.email,
  subject: `${input.otp} is your Ren ${input.type === "sign-in" ? "sign-in" : "verification"} code`,
  text: `Use ${input.otp} to ${input.type === "sign-in" ? "sign in" : "verify your email"} on Ren. The code expires in 10 minutes. If you didn't request it, you can ignore this email.`,
})
