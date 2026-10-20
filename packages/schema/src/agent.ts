export * as Agent from "./agent.js"

import { Effect, Schema } from "effect"
import { Auth } from "./auth.js"
import { Identifier } from "./identifier.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import { Settings } from "./settings.js"
import { Space } from "./space.js"

export const ID = Identifier.make("agt", "Agent.ID")
export type ID = typeof ID.Type

export const maximumNameLength = 64

export const Name = Schema.String.check(
  Schema.isNonEmpty({ message: "Name is required." }),
  Schema.isMaxLength(maximumNameLength, { message: `Use ${maximumNameLength} characters or fewer.` }),
  Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/u, {
    message: "Use lowercase letters, digits and dashes, starting with a letter or digit.",
  }),
).annotate({ identifier: "Agent.Name" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  organizationId: Auth.OrganizationID,
  ownerSpaceId: Space.ID,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  isSubagent: Schema.Boolean,
  settings: Settings.Info,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  archivedAt: Schema.NullOr(Schema.DateTimeUtc),
}).annotate({ identifier: "Agent.Info" })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  spaceId: Schema.optional(Space.ID),
  isSubagent: Schema.optional(Schema.Boolean),
  ...Pagination.fields(50),
}).annotate({ identifier: "Agent.ListInput" })

const Page = Pagination.Page(Info).annotate({ identifier: "Agent.Page" })

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({
  ownerSpaceId: Space.ID,
  name: Name,
  description: Schema.optional(Schema.String),
  isSubagent: Schema.Boolean.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(false))),
  settings: Settings.Info.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed({ permissions: [], references: [] }))),
}).annotate({ identifier: "Agent.CreateInput" })

export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}
export const UpdateInput = Schema.Struct({
  name: Schema.optional(Name),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  isSubagent: Schema.optional(Schema.Boolean),
  settings: Schema.optional(Settings.Info),
}).annotate({ identifier: "Agent.UpdateInput" })

export interface TransferOwnershipInput extends Schema.Schema.Type<typeof TransferOwnershipInput> {}
export const TransferOwnershipInput = Schema.Struct({ spaceId: Space.ID }).annotate({
  identifier: "Agent.TransferOwnershipInput",
})

export const definition = Primitive.define({
  name: "agent",
  plural: "agents",
  id: ID,
  info: Info,
  list: { input: ListInput, page: Page },
  get: true,
  create: { input: CreateInput, result: Info },
  update: { input: UpdateInput, result: Info },
  archive: true,
  actions: { transferOwnership: { input: TransferOwnershipInput, result: Info } },
})
