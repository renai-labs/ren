export * as Environment from "./environment.js"

import { Effect, Schema } from "effect"
import { Identifier } from "./identifier.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import type { Session } from "./session.js"
import { Space } from "./space.js"

export const ID = Identifier.make("env", "Environment.ID")
export type ID = typeof ID.Type

export const sessionDirectory = (sessionId: Session.ID) => `/workspace/${sessionId}`

export const Capability = Schema.Literals(["processes", "files"]).annotate({ identifier: "Environment.Capability" })
export type Capability = typeof Capability.Type

export const capabilities: ReadonlyArray<Capability> = ["files", "processes"]

const ProviderID = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9-]*$/u, { message: "Use lowercase letters, digits and dashes." }),
).annotate({ identifier: "Environment.ProviderID" })

export const maximumSessionsPerHand = 100

export const defaultSessionsPerHand = 8

const SessionsPerHand = Schema.Int.check(
  Schema.isBetween(
    { minimum: 1, maximum: maximumSessionsPerHand },
    { message: `Use 1 to ${maximumSessionsPerHand} sessions per hand.` },
  ),
)

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  spaceId: Space.ID,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  provider: ProviderID,
  config: Schema.Json,
  sessionsPerHand: Schema.Int,
  canUpdate: Schema.Boolean,
  canArchive: Schema.Boolean,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  archivedAt: Schema.NullOr(Schema.DateTimeUtc),
}).annotate({ identifier: "Environment.Info" })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  spaceId: Schema.optional(Space.ID),
  ...Pagination.fields(50),
}).annotate({ identifier: "Environment.ListInput" })

const Page = Pagination.Page(Info).annotate({ identifier: "Environment.Page" })

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({
  spaceId: Space.ID,
  name: Space.Name,
  description: Schema.optional(Schema.String),
  provider: ProviderID,
  config: Schema.Json.annotate({ description: "The settings of the provider. Its schema is in the provider list." }),
  sessionsPerHand: SessionsPerHand.pipe(Schema.withDecodingDefaultKey(Effect.succeed(defaultSessionsPerHand))),
}).annotate({ identifier: "Environment.CreateInput" })

export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}
export const UpdateInput = Schema.Struct({
  name: Schema.optional(Space.Name),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  config: Schema.optional(Schema.Json),
  sessionsPerHand: Schema.optional(SessionsPerHand),
}).annotate({ identifier: "Environment.UpdateInput" })

export interface ProviderInfo extends Schema.Schema.Type<typeof ProviderInfo> {}
export const ProviderInfo = Schema.Struct({
  id: ProviderID,
  title: Schema.String,
  description: Schema.String,
  capabilities: Schema.Array(Capability),
  configSchema: Schema.Json.annotate({
    description: "A JSON Schema document (draft 2020-12) of the provider’s config.",
  }),
}).annotate({ identifier: "Environment.ProviderInfo" })

export const Providers = Schema.Array(ProviderInfo).annotate({ identifier: "Environment.Providers" })

export const definition = Primitive.define({
  name: "environment",
  plural: "environments",
  id: ID,
  info: Info,
  list: { input: ListInput, page: Page },
  get: true,
  create: { input: CreateInput, result: Info },
  update: { input: UpdateInput, result: Info },
  archive: true,
})

export interface Location extends Schema.Schema.Type<typeof Location> {}
export const Location = Schema.Struct({
  environmentId: ID,
  directory: Schema.String.check(Schema.isStartingWith("/")),
  capabilities: Schema.optionalKey(
    Schema.Array(Capability).annotate({
      description: "What the environment’s executors can do. Without it, they can do everything.",
    }),
  ),
}).annotate({ identifier: "Environment.Location" })

export interface Access extends Schema.Schema.Type<typeof Access> {}
export const Access = Schema.Struct({
  environmentId: ID,
  directory: Schema.String.check(Schema.isStartingWith("/")),
  url: Schema.String,
  token: Schema.String,
  expiresAt: Schema.DateTimeUtc,
  generation: Schema.Int.annotate({
    description: "Increases each time Ren gives the session another hand, not when its token is refreshed.",
  }),
}).annotate({ identifier: "Environment.Access" })
