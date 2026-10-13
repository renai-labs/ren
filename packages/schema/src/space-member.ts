export * as SpaceMember from "./space-member.js"

import { Schema } from "effect"
import { Auth } from "./auth.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import { Space } from "./space.js"

export const ID = Schema.Union([Space.MembershipID, Space.AssignmentID]).annotate({ identifier: "SpaceMember.ID" })
export type ID = typeof ID.Type

export const Status = Schema.Literals(["active", "pending"]).annotate({ identifier: "SpaceMember.Status" })
export type Status = typeof Status.Type

const Active = Schema.Struct({
  id: Space.MembershipID,
  spaceId: Space.ID,
  status: Schema.Literal("active"),
  userId: Auth.UserID,
  name: Schema.String,
  email: Schema.String,
  image: Schema.NullOr(Schema.String),
  createdAt: Schema.DateTimeUtc,
  archivedAt: Schema.NullOr(Schema.DateTimeUtc),
}).annotate({ identifier: "SpaceMember.Active" })

const Pending = Schema.Struct({
  id: Space.AssignmentID,
  spaceId: Space.ID,
  status: Schema.Literal("pending"),
  email: Schema.String,
  createdAt: Schema.DateTimeUtc,
  archivedAt: Schema.NullOr(Schema.DateTimeUtc),
}).annotate({ identifier: "SpaceMember.Pending" })

export const Info = Schema.Union([Active, Pending]).annotate({ identifier: "SpaceMember.Info" })
export type Info = typeof Info.Type

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  spaceId: Space.ID,
  status: Schema.optional(Status),
  ...Pagination.fields(50),
}).annotate({ identifier: "SpaceMember.ListInput" })

const Page = Pagination.Page(Info).annotate({ identifier: "SpaceMember.Page" })

export const CreateInput = Schema.Union([
  Schema.Struct({ spaceId: Space.ID, userId: Auth.UserID }),
  Schema.Struct({ spaceId: Space.ID, email: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(320)) }),
]).annotate({ identifier: "SpaceMember.CreateInput" })
export type CreateInput = typeof CreateInput.Type

export const definition = Primitive.define({
  name: "space-member",
  plural: "space-members",
  id: ID,
  info: Info,
  list: { input: ListInput, page: Page },
  create: { input: CreateInput, result: Info },
  archive: true,
})
