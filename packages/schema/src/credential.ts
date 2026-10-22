export * as Credential from "./credential.js"

import { Effect, Schema } from "effect"

export const reservedFieldNames: ReadonlyArray<string> = ["token", "accessToken", "username", "password", "basic"]

export const EnvName = Schema.String.check(
  Schema.isMaxLength(128, { message: "Use 128 characters or fewer." }),
  Schema.isPattern(/^[A-Z_][A-Z0-9_]*$/u, { message: "Use UPPER_SNAKE_CASE, starting with a letter or underscore." }),
).annotate({ identifier: "Credential.EnvName" })

export const FieldName = Schema.String.check(
  Schema.isMaxLength(64, { message: "Use 64 characters or fewer." }),
  Schema.isPattern(/^[a-z][A-Za-z0-9_]*$/u, {
    message: "Start with a lowercase letter, then use letters, digits and underscores.",
  }),
  Schema.makeFilter((name) => !reservedFieldNames.includes(name) || `"${name}" is reserved.`),
).annotate({ identifier: "Credential.FieldName" })

export const Name = Schema.Union([EnvName, FieldName]).annotate({
  identifier: "Credential.Name",
  description: "The name of a required credential: an env name or a field name.",
})

const optional = Schema.Boolean.annotate({
  description:
    "An optional credential is not asked for at install. A feature that needs it fails until it is connected.",
}).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(false)))

export const Ref = Schema.NonEmptyString.annotate({
  identifier: "Credential.Ref",
  description: "The name of a credential that is connected in Ren. A value is never in a file.",
})

export interface When extends Schema.Schema.Type<typeof When> {}
export const When = Schema.Struct({
  name: FieldName,
  op: Schema.Literals(["eq", "neq"]),
  value: Schema.String,
}).annotate({ identifier: "Credential.When" })

export interface Env extends Schema.Schema.Type<typeof Env> {}
export const Env = Schema.Struct({
  kind: Schema.Literal("env"),
  name: EnvName,
  description: Schema.optionalKey(Schema.String),
  optional,
}).annotate({ identifier: "Credential.Env" })

export interface Secret extends Schema.Schema.Type<typeof Secret> {}
export const Secret = Schema.Struct({
  kind: Schema.Literal("secret"),
  name: FieldName,
  description: Schema.optionalKey(Schema.String),
  optional,
}).annotate({ identifier: "Credential.Secret" })

export interface OAuthApp extends Schema.Schema.Type<typeof OAuthApp> {}
export const OAuthApp = Schema.Struct({
  kind: Schema.Literal("oauth_app"),
  name: Schema.NonEmptyString,
  description: Schema.optionalKey(Schema.String),
  optional,
}).annotate({ identifier: "Credential.OAuthApp" })

export interface Text extends Schema.Schema.Type<typeof Text> {}
export const Text = Schema.Struct({
  kind: Schema.Literal("text"),
  name: FieldName,
  description: Schema.optionalKey(Schema.String),
  optional,
  message: Schema.NonEmptyString,
  placeholder: Schema.optionalKey(Schema.String),
  when: Schema.optionalKey(When),
}).annotate({ identifier: "Credential.Text" })

export interface Option extends Schema.Schema.Type<typeof Option> {}
export const Option = Schema.Struct({
  label: Schema.NonEmptyString,
  value: Schema.String,
  hint: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "Credential.Option" })

export interface Select extends Schema.Schema.Type<typeof Select> {}
export const Select = Schema.Struct({
  kind: Schema.Literal("select"),
  name: FieldName,
  description: Schema.optionalKey(Schema.String),
  optional,
  message: Schema.NonEmptyString,
  options: Schema.NonEmptyArray(Option),
  when: Schema.optionalKey(When),
}).annotate({ identifier: "Credential.Select" })

export const Requirement = Schema.Union([Env, Secret, OAuthApp, Text, Select]).annotate({
  identifier: "Credential.Requirement",
})
export type Requirement = typeof Requirement.Type

export const SkillRequirement = Schema.Union([Env, OAuthApp]).annotate({ identifier: "Credential.SkillRequirement" })
export type SkillRequirement = typeof SkillRequirement.Type
