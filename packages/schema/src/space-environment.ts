export * as SpaceEnvironment from "./space-environment.js"

import { Schema } from "effect"
import { Environment } from "./environment.js"
import { Identifier } from "./identifier.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import { Space } from "./space.js"

export const ID = Identifier.make("spe", "SpaceEnvironment.ID")
export type ID = typeof ID.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  spaceId: Space.ID,
  environmentId: Environment.ID,
  createdAt: Schema.DateTimeUtc,
  archivedAt: Schema.NullOr(Schema.DateTimeUtc),
}).annotate({ identifier: "SpaceEnvironment.Info" })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  spaceId: Space.ID,
  ...Pagination.fields(50),
}).annotate({ identifier: "SpaceEnvironment.ListInput" })

const Page = Pagination.Page(Info).annotate({ identifier: "SpaceEnvironment.Page" })

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({
  spaceId: Space.ID,
  environmentId: Environment.ID,
}).annotate({ identifier: "SpaceEnvironment.CreateInput" })

export const definition = Primitive.define({
  name: "space-environment",
  plural: "space-environments",
  id: ID,
  info: Info,
  list: { input: ListInput, page: Page },
  create: { input: CreateInput, result: Info },
  archive: true,
})
