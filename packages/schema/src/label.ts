export * as Label from "./label.js"

import { Schema, SchemaTransformation } from "effect"
import { Auth } from "./auth.js"
import { Identifier } from "./identifier.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import { Space } from "./space.js"

export const ID = Identifier.make("lbl", "Label.ID")
export type ID = typeof ID.Type

export const maximumNameLength = 64

export const Name = Schema.Trim.check(
  Schema.isNonEmpty({ message: "Name is required." }),
  Schema.isMaxLength(maximumNameLength, { message: `Use ${maximumNameLength} characters or fewer.` }),
).annotate({ identifier: "Label.Name" })

export const system = [
  { id: ID.make("lbl_00000000000000000000SYS001"), name: "ren-improve" },
  { id: ID.make("lbl_00000000000000000000SYS002"), name: "ren-fix" },
] as const

export const isReserved = (name: string) => name.toLowerCase().startsWith("ren-")

export const isSystem = (name: string) => system.some((label) => label.name === name.toLowerCase())

const UserName = Name.check(
  Schema.makeFilter((name) => !isReserved(name) || "Names that start with ren- are reserved."),
).annotate({ identifier: "Label.UserName" })

export const Color = Schema.String.pipe(Schema.decode(SchemaTransformation.toLowerCase()))
  .check(Schema.isPattern(/^#[0-9a-f]{6}$/u, { message: "Use a #rrggbb color." }))
  .annotate({ identifier: "Label.Color" })

export interface Summary extends Schema.Schema.Type<typeof Summary> {}
export const Summary = Schema.Struct({
  id: ID,
  name: Schema.String,
  color: Schema.NullOr(Schema.String),
  isSystem: Schema.Boolean,
}).annotate({ identifier: "Label.Summary" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  ...Summary.fields,
  organizationId: Schema.NullOr(Auth.OrganizationID),
  spaceId: Schema.NullOr(Space.ID).annotate({
    description: "The space of a space label, which only that space sees. Null for an org label or a system label.",
  }),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  archivedAt: Schema.NullOr(Schema.DateTimeUtc),
}).annotate({ identifier: "Label.Info" })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  spaceId: Schema.optional(Space.ID).annotate({
    description:
      "Only the system labels, the org labels and the labels of this space. Without it, the labels of every space you are in.",
  }),
  ...Pagination.fields(100),
}).annotate({ identifier: "Label.ListInput" })

const Page = Pagination.Page(Info).annotate({ identifier: "Label.Page" })

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({
  spaceId: Schema.optional(Space.ID).annotate({
    description: "Make a space label, which only this space sees. Without it, an org label, which only admins make.",
  }),
  name: UserName,
  color: Schema.optional(Schema.NullOr(Color)),
}).annotate({ identifier: "Label.CreateInput" })

export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}
export const UpdateInput = Schema.Struct({
  name: Schema.optional(UserName),
  color: Schema.optional(Schema.NullOr(Color)),
}).annotate({ identifier: "Label.UpdateInput" })

export const definition = Primitive.define({
  name: "label",
  plural: "labels",
  id: ID,
  info: Info,
  list: { input: ListInput, page: Page },
  create: { input: CreateInput, result: Info },
  update: { input: UpdateInput, result: Info },
  archive: true,
})
