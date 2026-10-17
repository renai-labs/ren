import { expect, test } from "bun:test"
import { Schema } from "effect"
import { AuthError } from "../src/features/auth/auth-error.js"
import { CompleteAuth } from "../src/features/auth/complete-auth.js"
import { AuthSchemas } from "../src/features/auth/schemas.js"

const failure = (error: { code?: string; message?: string; status?: number; statusText?: string }) =>
  AuthError.describe({ status: 400, statusText: "", ...error })

test("known Better Auth codes map to Ren’s codes, and rate limits win", () => {
  expect(failure({ code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" }).code).toBe("ALIAS_EMAIL")
  expect(failure({ code: "INVALID_OTP", status: 429 }).code).toBe("RATE_LIMITED")
})

test("unknown errors keep the server’s message and hide transport noise", () => {
  expect(failure({ code: "INVALID_TOKEN", message: "Invalid token" })).toEqual({
    code: "UNKNOWN",
    message: "Invalid token",
  })
  expect(failure({ message: "Failed to fetch", statusText: "Fetch Error", status: 0 }).message).toBe(
    "The authentication service is unavailable. Please try again.",
  )
  expect(failure({ message: "Boom", status: 503 }).message).toBe(
    "The authentication service is unavailable. Please try again.",
  )
  expect(failure({ statusText: "Bad Request" }).message).toBe("Bad Request")
})

test("redirects stay inside the app", () => {
  const decode = Schema.decodeUnknownSync(Schema.Struct({ redirect: AuthSchemas.Redirect }))
  expect(decode({ redirect: "/settings?tab=1" })).toEqual({ redirect: "/settings?tab=1" })
  expect(decode({ redirect: "//evil.example" })).toEqual({})
  expect(decode({ redirect: "/\\evil.example" })).toEqual({})
  expect(decode({ redirect: "https://evil.example" })).toEqual({})
  expect(decode({})).toEqual({})
})

test("finishing auth goes to the invitation before the redirect", () => {
  expect(CompleteAuth.href({ invitationId: "inv_1", redirect: "/settings", join: true })).toBe(
    "/invites/accept?id=inv_1&join=true&redirect=%2Fsettings",
  )
})
