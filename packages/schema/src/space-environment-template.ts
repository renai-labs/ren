export * as SpaceEnvironmentTemplate from "./space-environment-template.js"

import { Schema } from "effect"
import { EnvironmentTemplate } from "./environment-template.js"
import { Identifier } from "./identifier.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import { Space } from "./space.js"

export const ID = Identifier.make("spe", "SpaceEnvironmentTemplate.ID")
export type ID = typeof ID.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  spaceId: Space.ID,
  environmentTemplateId: EnvironmentTemplate.ID,
  createdAt: Schema.DateTimeUtc,
  archivedAt: Schema.NullOr(Schema.DateTimeUtc),
}).annotate({ identifier: "SpaceEnvironmentTemplate.Info" })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  spaceId: Space.ID,
  ...Pagination.fields(50),
}).annotate({ identifier: "SpaceEnvironmentTemplate.ListInput" })

const Page = Pagination.Page(Info).annotate({ identifier: "SpaceEnvironmentTemplate.Page" })

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({
  spaceId: Space.ID,
  environmentTemplateId: EnvironmentTemplate.ID,
}).annotate({ identifier: "SpaceEnvironmentTemplate.CreateInput" })

export const definition = Primitive.define({
  name: "space-environment-template",
  plural: "space-environment-templates",
  id: ID,
  info: Info,
  list: { input: ListInput, page: Page },
  create: { input: CreateInput, result: Info },
  archive: true,
})
