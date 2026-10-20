export * as Settings from "./settings.js"

import { Effect, Schema } from "effect"
import { Permission } from "./permission.js"
import { Reference } from "./reference.js"
import { Session } from "./session.js"

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  instructions: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Session.Model),
  permissions: Permission.RuleList.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed([]))),
  references: Reference.List.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed([]))),
}).annotate({ identifier: "Settings.Info" })

export const duplicateAlias = (settings: Info) => {
  const aliases = settings.references.map((reference) => reference.alias)
  return aliases.find((alias, index) => aliases.indexOf(alias) !== index)
}
