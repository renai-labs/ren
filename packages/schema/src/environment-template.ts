export * as EnvironmentTemplate from "./environment-template.js"

import { Effect, Schema, Struct } from "effect"
import { Auth } from "./auth.js"
import { EnvironmentProvider } from "./environment-provider.js"
import { HostName } from "./host-name.js"
import { Identifier } from "./identifier.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"

export const ID = Identifier.make("tpl", "EnvironmentTemplate.ID")
export type ID = typeof ID.Type

export const maximumSessionsPerEnvironment = 100

const defaultSessionsPerEnvironment = 8

const SessionsPerEnvironment = Schema.Int.check(
  Schema.isBetween(
    { minimum: 1, maximum: maximumSessionsPerEnvironment },
    { message: `Use 1 to ${maximumSessionsPerEnvironment} sessions per environment.` },
  ),
)

export const maximumAllowedHosts = 100

export const Networking = Schema.Union([
  Schema.Struct({ type: Schema.Literal("unrestricted") }),
  Schema.Struct({
    type: Schema.Literal("limited"),
    allowPackageManagers: Schema.Boolean.annotate({
      description: "Allow the hosts of npm, PyPI, the Debian and Ubuntu mirrors and the Go module proxy.",
    }),
    allowMcpServers: Schema.Boolean.annotate({ description: "Allow the hosts of the MCP servers of the space." }),
    allowedHosts: Schema.Array(HostName.Pattern).check(Schema.isMaxLength(maximumAllowedHosts)),
  }),
]).annotate({
  identifier: "EnvironmentTemplate.Networking",
  description:
    "Where a machine of the template can connect. A limited machine always reaches the hosts of the credentials of its space.",
})
export type Networking = typeof Networking.Type

const unrestricted = { type: "unrestricted" } as const satisfies Networking

export const BuildStatus = Schema.Literals(["queued", "building", "ready", "failed"]).annotate({
  identifier: "EnvironmentTemplate.BuildStatus",
  description: "The state of the latest build of the image. A provider that builds no image is ready at once.",
})
export type BuildStatus = typeof BuildStatus.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  organizationId: Auth.OrganizationID,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  provider: EnvironmentProvider.ID,
  config: Schema.Json,
  sessionsPerEnvironment: Schema.Int,
  networking: Networking,
  buildStatus: BuildStatus,
  image: Schema.NullOr(Schema.String).annotate({
    description: "The last image that built. Machines use it while a later build runs or after it fails.",
  }),
  buildError: Schema.NullOr(Schema.String).annotate({ description: "Why the latest build failed." }),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  archivedAt: Schema.NullOr(Schema.DateTimeUtc),
}).annotate({ identifier: "EnvironmentTemplate.Info" })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  ...Pagination.fields(50),
}).annotate({ identifier: "EnvironmentTemplate.ListInput" })

const Page = Pagination.Page(Info).annotate({ identifier: "EnvironmentTemplate.Page" })

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({
  name: Primitive.Name,
  description: Schema.optional(Schema.String),
  provider: EnvironmentProvider.ID,
  config: Schema.Json.annotate({ description: "The settings of the provider. Its schema is in the provider list." }),
  sessionsPerEnvironment: SessionsPerEnvironment.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(defaultSessionsPerEnvironment)),
  ),
  networking: Networking.pipe(Schema.withDecodingDefaultKey(Effect.succeed(unrestricted))),
}).annotate({ identifier: "EnvironmentTemplate.CreateInput" })

export interface Declaration extends Schema.Schema.Type<typeof Declaration> {}
export const Declaration = CreateInput.mapFields((fields) => ({
  ...Struct.omit(fields, ["name"]),
  description: Schema.optionalKey(Schema.String),
})).annotate({
  identifier: "EnvironmentTemplate.Declaration",
})

export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}
export const UpdateInput = Schema.Struct({
  name: Schema.optional(Primitive.Name),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  config: Schema.optional(
    Schema.Json.annotate({
      description: "A changed config queues a build. A machine gets the new image when it wakes.",
    }),
  ),
  sessionsPerEnvironment: Schema.optional(SessionsPerEnvironment),
  networking: Schema.optional(Networking),
}).annotate({ identifier: "EnvironmentTemplate.UpdateInput" })

export interface RetryBuildInput extends Schema.Schema.Type<typeof RetryBuildInput> {}
export const RetryBuildInput = Schema.Struct({}).annotate({ identifier: "EnvironmentTemplate.RetryBuildInput" })

export const definition = Primitive.define({
  name: "environment-template",
  plural: "environment-templates",
  id: ID,
  info: Info,
  list: { input: ListInput, page: Page },
  get: true,
  create: { input: CreateInput, result: Info },
  update: { input: UpdateInput, result: Info },
  archive: true,
  actions: { retryBuild: { input: RetryBuildInput, result: Info } },
})
