export * as Invitation from "./invitation.js"

import { Schema } from "effect"
import { Auth } from "./auth.js"

export const State = Schema.Literals(["pending", "expired", "accepted", "unavailable", "invalid"]).annotate({
  identifier: "Invitation.State",
})
export type State = typeof State.Type

export interface Preview extends Schema.Schema.Type<typeof Preview> {}
export const Preview = Schema.Struct({
  state: State,
  organization: Schema.NullOr(
    Schema.Struct({
      id: Auth.OrganizationID,
      name: Schema.String,
      logo: Schema.NullOr(Schema.String),
    }),
  ),
  inviter: Schema.NullOr(Schema.Struct({ name: Schema.NullOr(Schema.String), email: Schema.String })),
}).annotate({ identifier: "Invitation.Preview" })
