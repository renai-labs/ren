export * as EnvironmentTemplate from "./environment-template.js"

import { Effect, Schema } from "effect"
import { Auth } from "./auth.js"
import { EnvironmentProvider } from "./environment-provider.js"
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

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  organizationId: Auth.OrganizationID,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  provider: EnvironmentProvider.ID,
  config: Schema.Json,
  sessionsPerEnvironment: Schema.Int,
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
}).annotate({ identifier: "EnvironmentTemplate.CreateInput" })

export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}
export const UpdateInput = Schema.Struct({
  name: Schema.optional(Primitive.Name),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  config: Schema.optional(
    Schema.Json.annotate({
      description: "Applies to environments made after the change. Running environments keep their config.",
    }),
  ),
  sessionsPerEnvironment: Schema.optional(SessionsPerEnvironment),
}).annotate({ identifier: "EnvironmentTemplate.UpdateInput" })

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
})
