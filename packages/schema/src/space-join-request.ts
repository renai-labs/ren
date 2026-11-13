export * as SpaceJoinRequest from "./space-join-request.js"

import { Schema } from "effect"
import { Auth } from "./auth.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import { Space } from "./space.js"

export const ID = Space.JoinRequestID
export type ID = typeof ID.Type

export const maximumNoteLength = 500

export const Status = Schema.Literals(["pending", "approved", "declined", "cancelled"]).annotate({
  identifier: "SpaceJoinRequest.Status",
  description:
    "A pending request waits for a member of the space. It ends as approved or declined, or cancelled by the person who asked. Ren also cancels it when the person joins another way, the space is archived or the person leaves the organization.",
})
export type Status = typeof Status.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  spaceId: Space.ID,
  userId: Auth.UserID,
  name: Schema.String,
  email: Schema.String,
  image: Schema.NullOr(Schema.String),
  note: Schema.NullOr(Schema.String),
  status: Status,
  decidedBy: Schema.NullOr(Auth.UserID),
  createdAt: Schema.DateTimeUtc,
  decidedAt: Schema.NullOr(Schema.DateTimeUtc),
}).annotate({ identifier: "SpaceJoinRequest.Info" })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  spaceId: Schema.optional(Space.ID).annotate({
    description: "The space whose requests to list; its members only. Without it, the caller’s own requests.",
  }),
  status: Schema.optional(Status),
  ...Pagination.fields(50),
}).annotate({ identifier: "SpaceJoinRequest.ListInput" })

const Page = Pagination.Page(Info).annotate({ identifier: "SpaceJoinRequest.Page" })

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({
  spaceId: Space.ID,
  note: Schema.optional(
    Schema.String.check(
      Schema.isMaxLength(maximumNoteLength, { message: `Use ${maximumNoteLength} characters or fewer.` }),
    ),
  ),
}).annotate({ identifier: "SpaceJoinRequest.CreateInput" })

export const DecisionInput = Schema.Struct({}).annotate({ identifier: "SpaceJoinRequest.DecisionInput" })

export const definition = Primitive.define({
  name: "space-join-request",
  plural: "space-join-requests",
  id: ID,
  info: Info,
  list: { input: ListInput, page: Page },
  create: { input: CreateInput, result: Info },
  actions: {
    approve: { input: DecisionInput, result: Info },
    decline: { input: DecisionInput, result: Info },
    cancel: { input: DecisionInput, result: Info },
  },
})
