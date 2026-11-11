export * as Space from "./space.js"

import { Schema } from "effect"
import { Auth } from "./auth.js"
import { Brain } from "./brain.js"
import { MachineProvider } from "./machine-provider.js"
import { MachineTemplate } from "./machine-template.js"
import { Factory } from "./factory.js"
import { Identifier } from "./identifier.js"
import { Machine } from "./machine.js"
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

export const BrainMachine = Schema.Struct({
  provider: Schema.NullOr(MachineProvider.ID).annotate({
    description: "The brain provider of the space’s brains. Null when the deployment runs brains in cells.",
  }),
  environmentTemplateId: Schema.NullOr(MachineTemplate.ID).annotate({
    description:
      "A built template of the brain provider: the image, size and host list of the brain’s machine. Null: Ren’s system image.",
  }),
}).annotate({
  identifier: "Space.BrainMachine",
  description: "The machine of the space’s brains. A change reaches a brain when it wakes.",
})
export type BrainMachine = typeof BrainMachine.Type

export const Hand = Schema.Union([
  Schema.Struct({ placement: Schema.Literal("colocated") }),
  Schema.Struct({ placement: Schema.Literal("remote"), environmentTemplateId: MachineTemplate.ID }),
  Schema.Struct({ placement: Schema.Literal("none") }),
]).annotate({
  identifier: "Space.Hand",
  description:
    "Where the space’s chats run file and shell tools: on the brain’s own machine, on machines of a template that chats share, or nowhere. A change reaches a brain when it wakes; a chat started with none gets tools then.",
})
export type Hand = typeof Hand.Type

export const defaultHand: Hand = { placement: "colocated" }

export const AppliedHand = Schema.Union([
  Schema.Struct({ placement: Schema.Literal("colocated") }),
  Schema.Struct({ placement: Schema.Literal("remote"), version: Machine.Version }),
  Schema.Struct({ placement: Schema.Literal("none") }),
]).annotate({
  identifier: "Space.AppliedHand",
  description:
    "The hand that a brain runs its chats’ tools on now. It changes only when the brain starts or wakes, to the space’s hand at that time.",
})
export type AppliedHand = typeof AppliedHand.Type

export interface ShutdownReport extends Schema.Schema.Type<typeof ShutdownReport> {}
export const ShutdownReport = Schema.Struct({
  finishedAt: Schema.DateTimeUtc,
  problems: Schema.Array(Schema.String).annotate({
    description:
      "What the shutdown could not confirm: a brain whose chats it could not sync, or a machine it could not destroy. Empty when all went as planned.",
  }),
}).annotate({ identifier: "Space.ShutdownReport" })

export interface Compute extends Schema.Schema.Type<typeof Compute> {}
export const Compute = Schema.Struct({
  isPending: Schema.Boolean.annotate({
    description:
      "A brain of the space still runs an older brain or hand setting, or an older image of its template. It applies the new one when it wakes, or at a shutdown.",
  }),
  shutdown: Schema.NullOr(Schema.Literal("running")).annotate({ description: "A shutdown of the space runs now." }),
  lastShutdown: Schema.NullOr(ShutdownReport),
}).annotate({ identifier: "Space.Compute" })

export interface ShutdownInput extends Schema.Schema.Type<typeof ShutdownInput> {}
export const ShutdownInput = Schema.Struct({}).annotate({
  identifier: "Space.ShutdownInput",
  description:
    "Stops all work of the space, deletes the files on its machines and may lose chat changes that were not synced. Its brains and hands start again with the space’s settings at the next new work.",
})

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
  brain: BrainMachine,
  hand: Hand,
  compute: Compute,
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
  brain: Schema.optional(BrainMachine),
  hand: Schema.optional(Hand),
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
  actions: { shutdown: { input: ShutdownInput, result: Info } },
})
