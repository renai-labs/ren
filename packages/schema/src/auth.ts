export * as Auth from "./auth.js"

import { Schema } from "effect"
import { Identifier } from "./identifier.js"

export const UserID = Identifier.make("usr", "Auth.UserID")
export type UserID = typeof UserID.Type

export const SessionID = Identifier.make("aus", "Auth.SessionID")
export type SessionID = typeof SessionID.Type

export const AccountID = Identifier.make("acc", "Auth.AccountID")
export type AccountID = typeof AccountID.Type

export const VerificationID = Identifier.make("ver", "Auth.VerificationID")
export type VerificationID = typeof VerificationID.Type

export interface User extends Schema.Schema.Type<typeof User> {}
export const User = Schema.Struct({
  id: UserID,
  name: Schema.String,
  email: Schema.String,
  emailVerified: Schema.Boolean,
  image: Schema.optional(Schema.NullOr(Schema.String)),
}).annotate({ identifier: "Auth.User" })
