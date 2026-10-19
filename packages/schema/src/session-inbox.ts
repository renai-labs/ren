export * as SessionInbox from "./session-inbox.js"

import { Schema } from "effect"
import { Session } from "./session.js"
import { SessionMessage } from "./session-message.js"

export const Delivery = Schema.Literals(["steer", "queue"]).annotate({ identifier: "SessionInbox.Delivery" })
export type Delivery = typeof Delivery.Type

export interface UserPayload extends Schema.Schema.Type<typeof UserPayload> {}
export const UserPayload = Schema.Struct({
  ...SessionMessage.promptFields,
  sender: Schema.optionalKey(SessionMessage.Sender),
}).annotate({ identifier: "SessionInbox.UserPayload" })

export interface SyntheticPayload extends Schema.Schema.Type<typeof SyntheticPayload> {}
export const SyntheticPayload = Schema.Struct({
  text: Schema.String,
  description: Schema.optionalKey(Schema.String),
  metadata: Schema.optionalKey(SessionMessage.SyntheticMetadata),
}).annotate({ identifier: "SessionInbox.SyntheticPayload" })

const UserItem = Schema.Struct({ type: Schema.tag("user"), payload: UserPayload, delivery: Delivery })
const SyntheticItem = Schema.Struct({ type: Schema.tag("synthetic"), payload: SyntheticPayload, delivery: Delivery })
const CompactionItem = Schema.Struct({ type: Schema.tag("compaction"), payload: Schema.Struct({}), delivery: Delivery })

export const Item = Schema.Union([UserItem, SyntheticItem, CompactionItem])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "SessionInbox.Item" })
export type Item = typeof Item.Type

const Enqueued = {
  id: SessionMessage.ID,
  sessionID: Session.ID,
  time: Schema.Struct({ created: SessionMessage.Time }),
}

export interface User extends Schema.Schema.Type<typeof User> {}
export const User = Schema.Struct({ ...Enqueued, ...UserItem.fields }).annotate({ identifier: "SessionInbox.User" })

export interface Synthetic extends Schema.Schema.Type<typeof Synthetic> {}
export const Synthetic = Schema.Struct({ ...Enqueued, ...SyntheticItem.fields }).annotate({
  identifier: "SessionInbox.Synthetic",
})

export interface Compaction extends Schema.Schema.Type<typeof Compaction> {}
export const Compaction = Schema.Struct({ ...Enqueued, ...CompactionItem.fields }).annotate({
  identifier: "SessionInbox.Compaction",
})

export const Info = Schema.Union([User, Synthetic, Compaction])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "SessionInbox.Info" })
export type Info = typeof Info.Type
