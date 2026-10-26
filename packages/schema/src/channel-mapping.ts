export * as ChannelMapping from "./channel-mapping.js"

import { Schema } from "effect"
import { Agent } from "./agent.js"
import { Auth } from "./auth.js"
import { Channel } from "./channel.js"
import { ChannelInstall } from "./channel-install.js"
import { Identifier } from "./identifier.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import { Space } from "./space.js"

export const ID = Identifier.make("chm", "ChannelMapping.ID")
export type ID = typeof ID.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  installId: ChannelInstall.ID,
  provider: Channel.Provider,
  place: Schema.String.annotate({
    description: "The provider’s id of the place: a Slack channel, a Linear project, a GitHub repository.",
  }),
  placeName: Schema.String,
  space: Schema.Struct({ id: Space.ID, name: Schema.String }),
  agent: Schema.NullOr(Schema.Struct({ id: Agent.ID, name: Schema.String })).annotate({
    description: "Without it, the place reaches the ren agent.",
  }),
  fallback: Schema.Boolean.annotate({
    description: "A sender that Ren cannot match to a member of the space runs as the fallback user. Off: refused.",
  }),
  fallbackUser: Schema.NullOr(Schema.Struct({ id: Auth.UserID, name: Schema.String })),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
}).annotate({ identifier: "ChannelMapping.Info", description: "The link from one place to a space." })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  installId: Schema.optional(ChannelInstall.ID),
  spaceId: Schema.optional(Space.ID),
  ...Pagination.fields(100),
}).annotate({ identifier: "ChannelMapping.ListInput" })

const Page = Pagination.Page(Info).annotate({ identifier: "ChannelMapping.Page" })

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({
  installId: ChannelInstall.ID,
  place: Schema.NonEmptyString,
  spaceId: Space.ID,
  agentId: Schema.optional(Agent.ID).annotate({ description: "Without it, the place reaches the ren agent." }),
  fallback: Schema.optional(Schema.Boolean).annotate({
    description: "On by default, and off by default for a public GitHub repository.",
  }),
  fallbackUserId: Schema.optional(Auth.UserID).annotate({
    description: "A member of the space. Without it, the caller.",
  }),
}).annotate({
  identifier: "ChannelMapping.CreateInput",
  description:
    "Map a place, or replace the space, agent and fallback of its mapping. The same request twice gives the same mapping.",
})

export interface RemoveInput extends Schema.Schema.Type<typeof RemoveInput> {}
export const RemoveInput = Schema.Struct({}).annotate({ identifier: "ChannelMapping.RemoveInput" })

export const definition = Primitive.define({
  name: "channel-mapping",
  plural: "channel-mappings",
  id: ID,
  info: Info,
  list: { input: ListInput, page: Page },
  create: { input: CreateInput, result: Info },
  actions: { remove: { input: RemoveInput, result: Info } },
})
