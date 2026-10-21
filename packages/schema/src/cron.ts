export * as Cron from "./cron.js"

import { Effect, Schema } from "effect"
import { Agent } from "./agent.js"
import { Session } from "./session.js"

export const Schedule = Schema.String.check(
  Schema.makeFilter((schedule) => {
    const fields = schedule.trim().split(/\s+/u)
    return (
      (fields.length === 5 && fields.every((field) => /^[0-9A-Za-z*,/?#-]+$/u.test(field))) ||
      'Use a cron expression with five fields, for example "0 9 * * *".'
    )
  }),
).annotate({ identifier: "Cron.Schedule" })

export interface Declaration extends Schema.Schema.Type<typeof Declaration> {}
export const Declaration = Schema.Struct({
  agent: Schema.optionalKey(Agent.Name.annotate({ description: "Without it, the cron runs on the ren agent." })),
  schedule: Schedule,
  message: Schema.NonEmptyString,
  model: Schema.optionalKey(Session.Model),
  until: Schema.optionalKey(Schema.DateTimeUtcFromString.annotate({ description: "The last time it runs, in UTC." })),
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(true))),
}).annotate({ identifier: "Cron.Declaration" })
