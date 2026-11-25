export * as View from "./view.js"

import { Schema } from "effect"
import { Auth } from "./auth.js"
import { Identifier } from "./identifier.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import { Space } from "./space.js"

export const ID = Identifier.make("vw", "View.ID")
export type ID = typeof ID.Type

export const Type = Schema.Literals(["task"]).annotate({
  identifier: "View.Type",
  description: "What the view lists. `task`: tasks.",
})
export type Type = typeof Type.Type

export const maximumNameLength = 64

export const Name = Schema.Trim.check(
  Schema.isNonEmpty({ message: "Name is required." }),
  Schema.isMaxLength(maximumNameLength, { message: `Use ${maximumNameLength} characters or fewer.` }),
).annotate({ identifier: "View.Name" })

const Field = Schema.String.check(
  Schema.isPattern(/^[a-z][a-zA-Z]{0,31}$/u, { message: "Use a field name such as status or groupBy." }),
)

const Value = Schema.String.check(
  Schema.isNonEmpty({ message: "A filter value is required." }),
  Schema.isMaxLength(256, { message: "Use 256 characters or fewer." }),
)

export const Filters = Schema.Record(Field, Schema.Array(Value).check(Schema.isMaxLength(100)))
  .check(Schema.isMaxProperties(20))
  .annotate({
    identifier: "View.Filters",
    description:
      "The values each field must match, keyed by field. For tasks: `status`, `priority`, `agent`, `owner`, `label`, `space` and `review`. An item matches when each field has one of its values; `none` matches an empty field and `me` the person viewing.",
  })
export type Filters = typeof Filters.Type

export const Display = Schema.Struct({
  layout: Schema.Literals(["list", "board"]),
  groupBy: Field,
  orderBy: Field,
  direction: Schema.Literals(["asc", "desc"]),
  showEmpty: Schema.Boolean.annotate({ description: "Show groups that have no items." }),
  properties: Schema.Array(Field)
    .check(Schema.isMaxLength(20))
    .annotate({ description: "The fields each item shows, in order." }),
}).annotate({ identifier: "View.Display" })
export type Display = typeof Display.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  organizationId: Schema.NullOr(Auth.OrganizationID).annotate({ description: "Null for a system view." }),
  ownerId: Schema.NullOr(Auth.UserID).annotate({
    description: "The person who made the view. Null for a system view.",
  }),
  spaceId: Schema.NullOr(Space.ID).annotate({
    description: "The space whose page shows the view. Null for the page of the whole organization.",
  }),
  type: Type,
  name: Schema.String,
  shared: Schema.Boolean.annotate({
    description:
      "Shown to everyone who sees the view’s page: the members of its space, or the whole organization. Otherwise only its owner sees it. Sharing a view shows no item a person could not already see.",
  }),
  isSystem: Schema.Boolean.annotate({ description: "A view Ren gives every page, which nobody can change." }),
  filters: Filters,
  display: Schema.NullOr(Display).annotate({ description: "Null: the page keeps the layout the person last used." }),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  archivedAt: Schema.NullOr(Schema.DateTimeUtc),
}).annotate({ identifier: "View.Info" })

export const system: Readonly<Record<Type, ReadonlyArray<Pick<Info, "id" | "name" | "filters">>>> = {
  task: [
    { id: ID.make("vw_00000000000000000000SYS001"), name: "All", filters: {} },
    { id: ID.make("vw_00000000000000000000SYS002"), name: "Active", filters: { status: ["todo", "in_progress"] } },
    { id: ID.make("vw_00000000000000000000SYS003"), name: "Backlog", filters: { status: ["backlog"] } },
    { id: ID.make("vw_00000000000000000000SYS004"), name: "Needs review", filters: { review: ["needed"] } },
    { id: ID.make("vw_00000000000000000000SYS005"), name: "My tasks", filters: { owner: ["me"] } },
  ],
}

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  type: Schema.optional(Type).annotate({ description: "Only views of this type. Without it, views of every type." }),
  spaceId: Schema.optional(Space.Ref).annotate({
    description:
      "The views of this space’s page. Without it, the views of the organization’s page. Both start with the system views.",
  }),
  ...Pagination.fields(100),
}).annotate({ identifier: "View.ListInput" })

const Page = Pagination.Page(Info).annotate({ identifier: "View.Page" })

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({
  type: Type,
  spaceId: Schema.optional(Space.Ref).annotate({
    description: "Show the view on this space’s page. Without it, on the organization’s page.",
  }),
  name: Name,
  shared: Schema.optional(Schema.Boolean).annotate({ description: "Defaults to `false`: only you see the view." }),
  filters: Filters,
  display: Schema.optional(Schema.NullOr(Display)),
}).annotate({ identifier: "View.CreateInput" })

export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}
export const UpdateInput = Schema.Struct({
  name: Schema.optional(Name),
  shared: Schema.optional(Schema.Boolean),
  filters: Schema.optional(Filters),
  display: Schema.optional(Schema.NullOr(Display)),
}).annotate({ identifier: "View.UpdateInput" })

export const definition = Primitive.define({
  name: "view",
  plural: "views",
  id: ID,
  info: Info,
  list: { input: ListInput, page: Page },
  create: { input: CreateInput, result: Info },
  update: { input: UpdateInput, result: Info },
  archive: true,
})
