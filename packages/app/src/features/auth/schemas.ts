export * as AuthSchemas from "./schemas.js"

import { Option, Schema, SchemaTransformation } from "effect"
import { Email } from "../../lib/email.js"

const emailPattern = Email.pattern

const EmailAddress = Schema.Trim.check(Schema.isPattern(emailPattern, { message: "Enter a valid email" }))

const NewPassword = Schema.String.check(Schema.isMinLength(8, { message: "Password must be at least 8 characters" }))

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
      decode: Option.filter((value) => value !== undefined && emailPattern.test(value)),
      encode: (value) => value,
    }),
  ),
)

export const InvitationId = Schema.optional(Schema.NonEmptyString)

export const EmailStep = Schema.toStandardSchemaV1(Schema.Struct({ email: EmailAddress }))

export const SignupDetails = Schema.toStandardSchemaV1(
  Schema.Struct({
    name: Schema.Trim.check(
      Schema.isNonEmpty({ message: "Enter your name" }),
      Schema.isMaxLength(100, { message: "Name is too long" }),
    ),
    email: EmailAddress,
  }),
)

export const PasswordStep = Schema.toStandardSchemaV1(
  Schema.Struct({ password: Schema.String.check(Schema.isNonEmpty({ message: "Password is required" })) }),
)

export const NewPasswordStep = Schema.toStandardSchemaV1(Schema.Struct({ password: NewPassword }))

export const ResetPassword = Schema.toStandardSchemaV1(
  Schema.Struct({
    password: NewPassword,
    passwordConfirm: Schema.String.check(Schema.isNonEmpty({ message: "Confirm your password" })),
  }).check(
    Schema.makeFilter((value) =>
      value.password === value.passwordConfirm
        ? undefined
        : { path: ["passwordConfirm"], issue: "Passwords do not match" },
    ),
  ),
)
