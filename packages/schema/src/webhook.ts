export * as Webhook from "./webhook.js"

import { Effect, Schema } from "effect"
import { Agent } from "./agent.js"

export interface Declaration extends Schema.Schema.Type<typeof Declaration> {}
export const Declaration = Schema.Struct({
  agent: Schema.optionalKey(Agent.Name.annotate({ description: "Without it, the webhook runs on the ren agent." })),
  purpose: Schema.NonEmptyString,
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(true))),
}).annotate({ identifier: "Webhook.Declaration" })

export interface Request extends Schema.Schema.Type<typeof Request> {}
export const Request = Schema.Struct({
  threadKey: Schema.optionalKey(
    Schema.NonEmptyString.annotate({ description: "A request with the same key continues the same session." }),
  ),
  body: Schema.NonEmptyString,
}).annotate({ identifier: "Webhook.Request" })
