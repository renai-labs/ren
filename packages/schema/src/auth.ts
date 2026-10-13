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

export const Role = Schema.Literals(["owner", "admin", "member"]).annotate({ identifier: "Auth.Role" })
export type Role = typeof Role.Type

const administratorRoles: ReadonlyArray<string> = ["owner", "admin"] satisfies ReadonlyArray<Role>

export const isAdministrator = (role: string) =>
  role.split(",").some((each) => administratorRoles.includes(each.trim()))

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
