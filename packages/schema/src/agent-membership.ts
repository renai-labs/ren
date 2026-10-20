export * as AgentMembership from "./agent-membership.js"

import { Option, Schema } from "effect"
import { Agent } from "./agent.js"
import { Identifier } from "./identifier.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import { Space } from "./space.js"

export const ID = Identifier.make("agm", "AgentMembership.ID")
export type ID = typeof ID.Type

const ownerPrefix = "agm_owner_"

export const ofOwner = (agentId: Agent.ID) => ID.make(`${ownerPrefix}${agentId.slice(agentId.indexOf("_") + 1)}`)

export const ownerAgent = (id: ID) =>
  id.startsWith(ownerPrefix) ? Option.some(Agent.ID.make(`agt_${id.slice(ownerPrefix.length)}`)) : Option.none()

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  spaceId: Space.ID,
  agentId: Agent.ID,
  isOwner: Schema.Boolean,
  createdAt: Schema.DateTimeUtc,
}).annotate({ identifier: "AgentMembership.Info" })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  spaceId: Schema.optional(Space.ID),
  agentId: Schema.optional(Agent.ID),
  ...Pagination.fields(50),
}).annotate({ identifier: "AgentMembership.ListInput" })

const Page = Pagination.Page(Info).annotate({ identifier: "AgentMembership.Page" })

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({ spaceId: Space.ID, agentId: Agent.ID }).annotate({
  identifier: "AgentMembership.CreateInput",
})

export const definition = Primitive.define({
  name: "agent-membership",
  plural: "agent-memberships",
  id: ID,
  info: Info,
  list: { input: ListInput, page: Page },
  create: { input: CreateInput, result: Info },
  archive: true,
})
