export * as Brain from "./brain.js"

import { Identifier } from "./identifier.js"
import type { Session } from "./session.js"

export const ID = Identifier.make("brn", "Brain.ID")
export type ID = typeof ID.Type

export const ofSession = (sessionId: Session.ID) => ID.make(`brn_${Identifier.suffix(sessionId)}`)
