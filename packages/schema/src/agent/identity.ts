export * as AgentIdentity from "./identity.js"

import { Identifier } from "../identifier.js"

export const ID = Identifier.make("agt", "Agent.ID")
export type ID = typeof ID.Type
