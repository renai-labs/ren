export * as Environment from "./environment.js"

import { Effect, Schema } from "effect"
import { Auth } from "./auth.js"
import { Hand } from "./hand.js"
import { Identifier } from "./identifier.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import { Space } from "./space.js"

export const ID = Identifier.make("env", "Environment.ID")
export type ID = typeof ID.Type

export const maximumSessionsPerHand = 100

const defaultSessionsPerHand = 8

const SessionsPerHand = Schema.Int.check(
  Schema.isBetween(
    { minimum: 1, maximum: maximumSessionsPerHand },
    { message: `Use 1 to ${maximumSessionsPerHand} sessions per hand.` },
  ),
)

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  organizationId: Auth.OrganizationID,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  provider: Hand.ProviderID,
  config: Schema.Json,
  sessionsPerHand: Schema.Int,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  archivedAt: Schema.NullOr(Schema.DateTimeUtc),
}).annotate({ identifier: "Environment.Info" })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  ...Pagination.fields(50),
}).annotate({ identifier: "Environment.ListInput" })

const Page = Pagination.Page(Info).annotate({ identifier: "Environment.Page" })

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({
  name: Space.Name,
  description: Schema.optional(Schema.String),
  provider: Hand.ProviderID,
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
