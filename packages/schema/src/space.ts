export * as Space from "./space.js"

import { Schema } from "effect"
import { Auth } from "./auth.js"
import { Brain } from "./brain.js"
import { Factory } from "./factory.js"
import { Identifier } from "./identifier.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"

export const ID = Identifier.make("spc", "Space.ID")
export type ID = typeof ID.Type

export const MembershipID = Identifier.make("spm", "Space.MembershipID")
export type MembershipID = typeof MembershipID.Type

export const AssignmentID = Identifier.make("spp", "Space.AssignmentID")
export type AssignmentID = typeof AssignmentID.Type

export const Kind = Schema.Literals(["shared", "private"]).annotate({
  identifier: "Space.Kind",
  description:
    "A shared space belongs to its members. A private space belongs to its owner, who is its only member; it never changes kind.",
})
export type Kind = typeof Kind.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  organizationId: Auth.OrganizationID,
  kind: Kind,
  ownerUserId: Schema.NullOr(Auth.UserID).annotate({
    description: "The owner of a private space. Null for a shared space.",
  }),
  slug: Primitive.Slug.annotate({
    description: "Unique among the live spaces of the organization. A new name does not change it.",
  }),
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  brainScope: Brain.Scope,
  memberCount: Schema.Int,
  membershipId: Schema.NullOr(MembershipID),
  factory: Factory.Info,
  canUpdate: Schema.Boolean,
  canJoin: Schema.Boolean.annotate({ description: "An admin who is not a member can join this shared space." }),
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
  name: Primitive.Name,
  slug: Schema.optional(Primitive.Slug).annotate({
    description: "Without it, Ren makes one from the name and adds -2, -3, … when it is taken.",
  }),
  description: Schema.optional(Schema.String),
}).annotate({ identifier: "Space.CreateInput" })

export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}
export const UpdateInput = Schema.Struct({
  factory: Schema.optional(Factory.Info),
  name: Schema.optional(Primitive.Name),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  brainScope: Schema.optional(Brain.Scope),
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
