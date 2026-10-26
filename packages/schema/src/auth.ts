export * as Auth from "./auth.js"

import { Schema } from "effect"
import { Identifier } from "./identifier.js"

export const UserID = Identifier.make("usr", "Auth.UserID")
export type UserID = typeof UserID.Type

export const SessionID = Identifier.make("aus", "Auth.SessionID")

export const AccountID = Identifier.make("acc", "Auth.AccountID")

export const VerificationID = Identifier.make("ver", "Auth.VerificationID")

export const OrganizationID = Identifier.make("org", "Auth.OrganizationID")
export type OrganizationID = typeof OrganizationID.Type

export const MemberID = Identifier.make("mem", "Auth.MemberID")

export const InvitationID = Identifier.make("inv", "Auth.InvitationID")

export const JwkID = Identifier.make("jwk", "Auth.JwkID")

export const OAuthClientID = Identifier.make("ocl", "Auth.OAuthClientID")

export const OAuthResourceID = Identifier.make("ors", "Auth.OAuthResourceID")

export const OAuthClientResourceID = Identifier.make("ocr", "Auth.OAuthClientResourceID")

export const OAuthRefreshTokenID = Identifier.make("ort", "Auth.OAuthRefreshTokenID")

export const OAuthAccessTokenID = Identifier.make("oat", "Auth.OAuthAccessTokenID")

export const OAuthConsentID = Identifier.make("ocn", "Auth.OAuthConsentID")

export const OAuthClientAssertionID = Identifier.make("oca", "Auth.OAuthClientAssertionID")

export const consentOrganizationHeader = "x-ren-consent-organization"

export const SignInProvider = Schema.Literals(["google", "github", "slack"]).annotate({
  identifier: "Auth.SignInProvider",
})
export type SignInProvider = typeof SignInProvider.Type

export interface SignInProviders extends Schema.Schema.Type<typeof SignInProviders> {}
export const SignInProviders = Schema.Struct({ items: Schema.Array(SignInProvider) }).annotate({
  identifier: "Auth.SignInProviders",
})

export const Role = Schema.Literals(["owner", "admin", "member"]).annotate({ identifier: "Auth.Role" })
export type Role = typeof Role.Type

export const administratorRoles = ["owner", "admin"] as const satisfies ReadonlyArray<Role>

export const roles = (role: string) =>
  role
    .split(",")
    .map((each) => each.trim())
    .filter(Boolean)

export interface User extends Schema.Schema.Type<typeof User> {}
export const User = Schema.Struct({
  id: UserID,
  name: Schema.String,
  email: Schema.String,
  emailVerified: Schema.Boolean,
  image: Schema.optional(Schema.NullOr(Schema.String)),
}).annotate({ identifier: "Auth.User" })

export interface Organization extends Schema.Schema.Type<typeof Organization> {}
export const Organization = Schema.Struct({
  id: OrganizationID,
  name: Schema.String,
  slug: Schema.String,
  logo: Schema.optional(Schema.NullOr(Schema.String)),
}).annotate({ identifier: "Auth.Organization" })

export interface Me extends Schema.Schema.Type<typeof Me> {}
export const Me = Schema.Struct({
  user: User,
  organization: Schema.NullOr(Organization),
}).annotate({ identifier: "Auth.Me" })

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const isEmail = (value: string) => emailPattern.test(value)

export const normalizeEmail = (email: string) => email.trim().toLowerCase()

export const emailDomain = (email: string) => {
  const normalized = normalizeEmail(email)
  return normalized.slice(normalized.lastIndexOf("@") + 1)
}

export const Email = Schema.Trim.check(Schema.isPattern(emailPattern, { message: "Enter a valid email" }))

const minimumPasswordLength = 8

export const Password = Schema.String.check(
  Schema.isMinLength(minimumPasswordLength, {
    message: `Password must be at least ${minimumPasswordLength} characters`,
  }),
)

export const CurrentPassword = Schema.String.check(Schema.isNonEmpty({ message: "Password is required" }))

const PasswordConfirmation = Schema.String.check(Schema.isNonEmpty({ message: "Confirm your password" }))

export const maximumUserNameLength = 100

export const UserName = Schema.Trim.check(
  Schema.isNonEmpty({ message: "Enter your name" }),
  Schema.isMaxLength(maximumUserNameLength, { message: "Name is too long" }),
)

export const PasswordReset = Schema.Struct({
  password: Password,
  passwordConfirm: PasswordConfirmation,
}).check(
  Schema.makeFilter((value) =>
    value.password === value.passwordConfirm
      ? undefined
      : { path: ["passwordConfirm"], issue: "Passwords do not match" },
  ),
)

export const PasswordChange = Schema.Struct({
  currentPassword: CurrentPassword,
  newPassword: Password,
  newPasswordConfirm: PasswordConfirmation,
  revokeOtherSessions: Schema.Boolean,
}).check(
  Schema.makeFilter((value) =>
    value.newPassword === value.newPasswordConfirm
      ? undefined
      : { path: ["newPasswordConfirm"], issue: "Passwords do not match" },
  ),
)

export const maximumSlugLength = 128

export const organizationSlug = (name: string) =>
  name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, maximumSlugLength)
    .replaceAll(/-+$/g, "")

export const OrganizationName = Schema.String.check(
  Schema.makeFilter((name) => (name.trim() === "" ? "Name is required." : undefined)),
  Schema.makeFilter((name) =>
    name.trim() !== "" && organizationSlug(name) === ""
      ? "Use at least one letter or number to generate a slug."
      : undefined,
  ),
)
