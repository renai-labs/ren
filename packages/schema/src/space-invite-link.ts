export * as SpaceInviteLink from "./space-invite-link.js"

import { Schema } from "effect"
import { Auth } from "./auth.js"
import { Identifier } from "./identifier.js"
import { Space } from "./space.js"

export const ID = Identifier.make("sil", "SpaceInviteLink.ID")
export type ID = typeof ID.Type

export const tokenPrefix = "sil_"

export const Token = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)).annotate({
  identifier: "SpaceInviteLink.Token",
})

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  spaceId: Space.ID,
  token: Token.annotate({ description: "The secret in the link: `/join/<token>` on the app’s address." }),
  uses: Schema.Int.annotate({ description: "How many people joined the space with this link." }),
  createdAt: Schema.DateTimeUtc,
}).annotate({ identifier: "SpaceInviteLink.Info" })

export const State = Schema.Literals(["joinable", "member", "outside", "invalid"]).annotate({
  identifier: "SpaceInviteLink.State",
  description:
    "`joinable`: the person is in the organization and can join. `member`: already in the space. `outside`: not in the space’s organization. `invalid`: the link was reset, its space archived, or it never existed.",
})
export type State = typeof State.Type

export interface Preview extends Schema.Schema.Type<typeof Preview> {}
export const Preview = Schema.Struct({
  state: State,
  organization: Schema.NullOr(Schema.Struct({ id: Auth.OrganizationID, name: Schema.String })),
  space: Schema.NullOr(Schema.Struct({ id: Space.ID, slug: Schema.String, name: Schema.String })).annotate({
    description: "Null when the person is outside the organization or the link is invalid.",
  }),
}).annotate({ identifier: "SpaceInviteLink.Preview" })

export interface Joined extends Schema.Schema.Type<typeof Joined> {}
export const Joined = Schema.Struct({
  organizationId: Auth.OrganizationID,
  spaceId: Space.ID,
  slug: Schema.String,
}).annotate({ identifier: "SpaceInviteLink.Joined" })
