export * as AgentIdentity from "./identity.js"

import { Identifier } from "../identifier.js"
import { Primitive } from "../primitive.js"

export const ID = Identifier.make("agt", "Agent.ID")
export type ID = typeof ID.Type

export const Ref = Primitive.reference("agent", ID, "The agent’s name or ID.")
