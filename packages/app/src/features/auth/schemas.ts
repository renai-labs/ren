export * as AuthSchemas from "./schemas.js"

import { Auth } from "@ren/schema/auth"
import { Option, Schema, SchemaTransformation } from "effect"

const isSafeRedirect = (path: string) => path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\")

export const Redirect = Schema.optional(Schema.String).pipe(
  Schema.decodeTo(
    Schema.optional(Schema.String),
    SchemaTransformation.transformOptional({
      decode: Option.filter((value) => value !== undefined && isSafeRedirect(value)),
      encode: (value) => value,
    }),
  ),
)

export const OptionalEmail = Schema.optional(Schema.String).pipe(
  Schema.decodeTo(
    Schema.optional(Schema.String),
    SchemaTransformation.transformOptional({
      decode: Option.filter((value) => value !== undefined && Auth.isEmail(value)),
      encode: (value) => value,
    }),
  ),
)

export const InvitationId = Schema.optional(Schema.NonEmptyString)

export const AuthorizationSignature = Schema.optional(Schema.NonEmptyString)

export const EmailStep = Schema.toStandardSchemaV1(Schema.Struct({ email: Auth.Email }))

export const SignupDetails = Schema.toStandardSchemaV1(
  Schema.Struct({
    name: Auth.UserName,
    email: Auth.Email,
  }),
)

export const PasswordStep = Schema.toStandardSchemaV1(Schema.Struct({ password: Auth.CurrentPassword }))

export const NewPasswordStep = Schema.toStandardSchemaV1(Schema.Struct({ password: Auth.Password }))

export const ResetPassword = Schema.toStandardSchemaV1(Auth.PasswordReset)
