export * as Credential from "./credential.js"

import { Effect, Schema } from "effect"
import { Auth } from "./auth.js"
import { Identifier } from "./identifier.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import { Space } from "./space.js"

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

export const ID = Identifier.make("crd", "Credential.ID")
export type ID = typeof ID.Type

export const maximumPerOwner = 100

export const maximumValueBytes = 16 * 1024

export const maximumFields = 20

export const maximumHosts = 20

export const reservedEnvNames: ReadonlyArray<string> = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "PWD",
  "TMPDIR",
  "LANG",
  "TERM",
  "LD_*",
  "DYLD_*",
  "NODE_OPTIONS",
  "PYTHONPATH",
  "PYTHONHOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "SSL_CERT_FILE",
  "REQUESTS_CA_BUNDLE",
  "NODE_EXTRA_CA_CERTS",
  "CURL_CA_BUNDLE",
  "GIT_SSL_CAINFO",
  "AWS_CA_BUNDLE",
  "REN_*",
  "OPENCODE_*",
  "BUN_*",
  "GIT_*",
  "GH_TOKEN",
  "GITHUB_TOKEN",
]

export const isReservedEnvName = (name: string) => {
  const upper = name.toUpperCase()
  return reservedEnvNames.some((reserved) =>
    reserved.endsWith("*") ? upper.startsWith(reserved.slice(0, -1)) : upper === reserved,
  )
}

export const Label = EnvName.check(
  Schema.makeFilter((name) => !isReservedEnvName(name) || `${name} is a name the sandbox needs; use another label.`),
).annotate({
  identifier: "Credential.Label",
  description: "The credential’s env name. Workloads hold `ren:<LABEL>`. It never changes after create.",
})
export type Label = typeof Label.Type

const hostLabel = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"

const privateSuffixes = [".localhost", ".local", ".internal", ".lan", ".localdomain", ".home.arpa"]

export const Host = Schema.String.check(
  Schema.isMaxLength(253),
  Schema.isPattern(new RegExp(`^(?:\\*\\.)?(?:${hostLabel}\\.)+[a-z][a-z0-9-]*[a-z0-9]$`, "u"), {
    message: "Use a host name such as api.example.com, or *.example.com.",
  }),
  Schema.makeFilter(
    (host) => host.replace(/^\*\./u, "").includes(".") || "A wildcard covers the subdomains of one domain.",
  ),
  Schema.makeFilter(
    (host) =>
      !privateSuffixes.some((suffix) => `.${host}`.endsWith(suffix)) || "Private host names cannot get credentials.",
  ),
).annotate({
  identifier: "Credential.Host",
  description: "A host that may get the credential: a name, or `*.<domain>` for its subdomains.",
})

export const matchesHost = (pattern: string, host: string) =>
  pattern.startsWith("*.") ? host.endsWith(pattern.slice(1)) : pattern === host

export const Hosts = Schema.Array(Host)
  .check(Schema.isMinLength(1, { message: "Add at least one host." }), Schema.isMaxLength(maximumHosts))
  .annotate({ identifier: "Credential.Hosts" })

export const Owner = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("org") }),
  Schema.Struct({ kind: Schema.Literal("space"), spaceId: Space.ID }),
  Schema.Struct({ kind: Schema.Literal("person"), userId: Auth.UserID }),
]).annotate({ identifier: "Credential.Owner" })
export type Owner = typeof Owner.Type

export const OwnerKind = Schema.Literals(["org", "space", "person"]).annotate({ identifier: "Credential.OwnerKind" })
export type OwnerKind = typeof OwnerKind.Type

export const Type = Schema.Literals(["key", "basic", "oauth", "fields", "route", "client_credentials"]).annotate({
  identifier: "Credential.Type",
})
export type Type = typeof Type.Type

export const Location = Schema.Literals(["header", "query", "path", "body"]).annotate({
  identifier: "Credential.Location",
})
export type Location = typeof Location.Type

export const HeaderName = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9-]{1,64}$/u, { message: "Use a header name such as Authorization." }),
)

export const Inject = Schema.Union([
  Schema.Struct({ op: Schema.Literal("replace"), in: Schema.NonEmptyArray(Location) }),
  Schema.Struct({
    op: Schema.Literal("setHeader"),
    name: HeaderName,
    format: Schema.Literals(["Bearer {value}", "Basic {basic}", "{value}"]),
  }),
  Schema.Struct({ op: Schema.Literal("route") }),
]).annotate({
  identifier: "Credential.Inject",
  description:
    "Where the egress puts the value: `replace` swaps the placeholder where it is found, `setHeader` sets a header on every request to the hosts, `route` forwards to the value as the upstream URL.",
})
export type Inject = typeof Inject.Type

export const defaultInject = (type: Type): Inject =>
  type === "basic"
    ? { op: "setHeader", name: "Authorization", format: "Basic {basic}" }
    : { op: "replace", in: ["header", "query", "path"] }

export const Delivery = Schema.Literals(["egress", "delivered"]).annotate({
  identifier: "Credential.Delivery",
  description: "`delivered` puts the real value into the workload, for traffic the egress cannot read yet.",
})
export type Delivery = typeof Delivery.Type

export const Status = Schema.Literals(["ok", "reconnect"]).annotate({ identifier: "Credential.Status" })
export type Status = typeof Status.Type

export const placeholderPrefix = "ren:"

export const placeholder = (label: string, field?: string) => `${placeholderPrefix}${label}${field ? `.${field}` : ""}`

export const placeholderPattern = /ren:([A-Z_][A-Z0-9_]*)(?:\.([a-z][A-Za-z0-9_]*))?/gu

const SecretValue = Schema.RedactedFromValue(
  Schema.String.check(
    Schema.isNonEmpty({ message: "Enter a value." }),
    Schema.makeFilter(
      (value) =>
        new TextEncoder().encode(value).length <= maximumValueBytes || `Use ${maximumValueBytes / 1024} KB or less.`,
    ),
  ),
)

export const Value = Schema.Union([
  Schema.Struct({ type: Schema.Literal("key"), value: SecretValue }),
  Schema.Struct({ type: Schema.Literal("basic"), username: Schema.NonEmptyString, password: SecretValue }),
  Schema.Struct({
    type: Schema.Literal("fields"),
    fields: Schema.Record(FieldName, SecretValue).check(
      Schema.isMinProperties(1),
      Schema.isMaxProperties(maximumFields, { message: `Use ${maximumFields} fields or fewer.` }),
    ),
  }),
]).annotate({ identifier: "Credential.Value", description: "A pasted value. Ren never returns it." })
export type Value = typeof Value.Type

export interface Account extends Schema.Schema.Type<typeof Account> {}
export const Account = Schema.Struct({ userId: Auth.UserID, name: Schema.String }).annotate({
  identifier: "Credential.Account",
})

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  organizationId: Auth.OrganizationID,
  owner: Owner,
  label: EnvName,
  name: Schema.NullOr(Schema.String),
  type: Type,
  keyPreview: Schema.NullOr(Schema.String).annotate({
    description: "The last 4 characters of a key, or the username of a basic credential.",
  }),
  fieldNames: Schema.Array(Schema.String),
  hosts: Schema.Array(Schema.String),
  inject: Inject,
  delivery: Delivery,
  account: Schema.NullOr(Account).annotate({ description: "Whose account a sign-in reaches. A pasted key has none." }),
  scopes: Schema.Array(Schema.String),
  status: Status,
  expiresAt: Schema.NullOr(Schema.DateTimeUtc),
  createdBy: Schema.NullOr(Auth.UserID),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
}).annotate({ identifier: "Credential.Info" })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  owner: Schema.optional(OwnerKind),
  spaceId: Schema.optional(Space.ID),
  type: Schema.optional(Type),
  search: Schema.optional(Schema.String),
  ...Pagination.fields(50),
}).annotate({ identifier: "Credential.ListInput" })

const Page = Pagination.Page(Info).annotate({ identifier: "Credential.Page" })

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({
  owner: Owner,
  label: Label,
  name: Schema.optional(Primitive.Name),
  hosts: Hosts,
  inject: Schema.optional(Inject),
  delivery: Schema.optional(Delivery),
  value: Value,
}).annotate({ identifier: "Credential.CreateInput" })

export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}
export const UpdateInput = Schema.Struct({
  name: Schema.optional(Schema.NullOr(Primitive.Name)),
  hosts: Schema.optional(Hosts),
  delivery: Schema.optional(Delivery),
}).annotate({ identifier: "Credential.UpdateInput" })

export interface RotateInput extends Schema.Schema.Type<typeof RotateInput> {}
export const RotateInput = Schema.Struct({ value: Value }).annotate({ identifier: "Credential.RotateInput" })

export interface MoveInput extends Schema.Schema.Type<typeof MoveInput> {}
export const MoveInput = Schema.Struct({ owner: Owner }).annotate({ identifier: "Credential.MoveInput" })

export interface RemoveInput extends Schema.Schema.Type<typeof RemoveInput> {}
export const RemoveInput = Schema.Struct({}).annotate({ identifier: "Credential.RemoveInput" })

export const definition = Primitive.define({
  name: "credential",
  plural: "credentials",
  id: ID,
  info: Info,
  list: { input: ListInput, page: Page },
  get: true,
  create: { input: CreateInput, result: Info },
  update: { input: UpdateInput, result: Info },
  actions: {
    rotate: { input: RotateInput, result: Info },
    move: { input: MoveInput, result: Info },
    copy: { input: MoveInput, result: Info },
    remove: { input: RemoveInput, result: Info },
  },
})
