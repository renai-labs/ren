export * as Space from "./space.js"

import { Schema } from "effect"
import { Auth } from "./auth.js"
import { Identifier } from "./identifier.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"

export const ID = Identifier.make("spc", "Space.ID")
export type ID = typeof ID.Type

export const MembershipID = Identifier.make("spm", "Space.MembershipID")
export type MembershipID = typeof MembershipID.Type

export const AssignmentID = Identifier.make("spp", "Space.AssignmentID")
export type AssignmentID = typeof AssignmentID.Type

export const maximumNameLength = 256

export const Name = Schema.String.check(
  Schema.isTrimmed({ message: "Remove spaces at the start and end." }),
  Schema.isNonEmpty({ message: "Name is required." }),
  Schema.isMaxLength(maximumNameLength, { message: `Use ${maximumNameLength} characters or fewer.` }),
)

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  organizationId: Auth.OrganizationID,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  memberCount: Schema.Int,
  membershipId: Schema.NullOr(MembershipID),
  canUpdate: Schema.Boolean,
  canAddMember: Schema.Boolean,
  canRemoveMember: Schema.Boolean,
  canArchive: Schema.Boolean,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  archivedAt: Schema.NullOr(Schema.DateTimeUtc),
}).annotate({ identifier: "Space.Info" })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  joined: Schema.optional(Schema.Boolean),
  ...Pagination.fields(50),
}).annotate({ identifier: "Space.ListInput" })

const Page = Pagination.Page(Info).annotate({ identifier: "Space.Page" })

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({
  name: Name,
  description: Schema.optional(Schema.String),
}).annotate({ identifier: "Space.CreateInput" })

export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}
export const UpdateInput = Schema.Struct({
  name: Schema.optional(Name),
  description: Schema.optional(Schema.NullOr(Schema.String)),
}).annotate({ identifier: "Space.UpdateInput" })

export const definition = Primitive.define({
  name: "space",
  plural: "spaces",
  id: ID,
  info: Info,
  list: { input: ListInput, page: Page },
  get: true,
  create: { input: CreateInput, result: Info },
  update: { input: UpdateInput, result: Info },
  archive: true,
})
