export * as OrganizationInviteLink from "./organization-invite-link.js"

import { Schema } from "effect"
import { Auth } from "./auth.js"
import { Identifier } from "./identifier.js"
import { Space } from "./space.js"

export const ID = Identifier.make("oil", "OrganizationInviteLink.ID")
export type ID = typeof ID.Type

export const tokenPrefix = "oil_"

export const Token = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)).annotate({
  identifier: "OrganizationInviteLink.Token",
})

export const Expiry = Schema.Literals(["1d", "7d", "30d"]).annotate({
  identifier: "OrganizationInviteLink.Expiry",
  description: "When a new link expires: in 1 day, in 7 days or in 30 days.",
})
export type Expiry = typeof Expiry.Type

export const LinkSpace = Schema.Struct({ id: Space.ID, name: Schema.String })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  token: Token.annotate({ description: "The secret in the link: `/join/<token>` on the app’s address." }),
  spaces: Schema.Array(LinkSpace).annotate({
    description: "The shared spaces that the link adds people to. The organization’s first space is always one.",
  }),
  createdBy: Schema.Struct({ id: Auth.UserID, name: Schema.String }),
  uses: Schema.Int.annotate({ description: "How many times people used the link." }),
  expiresAt: Schema.DateTimeUtc,
  createdAt: Schema.DateTimeUtc,
}).annotate({ identifier: "OrganizationInviteLink.Info" })

export interface List extends Schema.Schema.Type<typeof List> {}
export const List = Schema.Struct({ items: Schema.Array(Info) }).annotate({
  identifier: "OrganizationInviteLink.List",
  description: "The links that still work: not revoked and not expired. The newest comes first.",
})

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({
  spaceIds: Schema.Array(Space.ID).annotate({
    description:
      "Shared spaces that you are in. Ren adds the organization’s first space to the link when it is not here.",
  }),
  expiresIn: Expiry,
}).annotate({ identifier: "OrganizationInviteLink.CreateInput" })

export const State = Schema.Literals(["pending", "expired", "revoked", "invalid"]).annotate({
  identifier: "OrganizationInviteLink.State",
  description: "`invalid`: the link never existed.",
})
export type State = typeof State.Type

export interface Preview extends Schema.Schema.Type<typeof Preview> {}
export const Preview = Schema.Struct({
  state: State,
  organization: Schema.NullOr(
    Schema.Struct({ id: Auth.OrganizationID, name: Schema.String, logo: Schema.NullOr(Schema.String) }),
  ),
  inviter: Schema.NullOr(Schema.Struct({ name: Schema.String })),
  spaces: Schema.Array(LinkSpace),
}).annotate({ identifier: "OrganizationInviteLink.Preview" })

export interface Joined extends Schema.Schema.Type<typeof Joined> {}
export const Joined = Schema.Struct({
  organizationId: Auth.OrganizationID,
  spaceId: Space.ID.annotate({ description: "The first space of the link: where the person lands." }),
  slug: Schema.String,
}).annotate({ identifier: "OrganizationInviteLink.Joined" })
