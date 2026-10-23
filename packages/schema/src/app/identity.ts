export * as AppIdentity from "./identity.js"

import { Identifier } from "../identifier.js"

export const ID = Identifier.make("app", "App.ID")
export type ID = typeof ID.Type
