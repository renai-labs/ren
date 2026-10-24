export * as RegisteredKey from "./registered-key.js"

import { Schema } from "effect"
import { Identifier } from "./identifier.js"

export const ID = Identifier.make("rgk", "RegisteredKey.ID")
export type ID = typeof ID.Type

export const Kind = Schema.Literals(["egress", "device"]).annotate({ identifier: "RegisteredKey.Kind" })
export type Kind = typeof Kind.Type
