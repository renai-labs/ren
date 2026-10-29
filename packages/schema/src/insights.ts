export * as Insights from "./insights.js"

import { DateTime, Duration, Effect, Option, Schema } from "effect"
import { Auth } from "./auth.js"
import { Space } from "./space.js"
import { Usage } from "./usage.js"

const maximumRange = Duration.days(400)

const maximumHours = Duration.hours(400)

const maximumLimit = 200

export const GroupBy = Schema.Literals([
  "none",
  "hour",
  "day",
  "week",
  "member",
  "agent",
  "model",
  "provider",
]).annotate({ identifier: "Insights.GroupBy" })
export type GroupBy = typeof GroupBy.Type

export const OrderBy = Schema.Literals(["cost", "tokens", "calls", "sessions", "tasksDone"]).annotate({
  identifier: "Insights.OrderBy",
})
export type OrderBy = typeof OrderBy.Type

export const TimeZone = Schema.String.check(
  Schema.makeFilter(
    (zone) => Option.isSome(DateTime.zoneMakeNamed(zone)) || "Use an IANA time zone, such as Europe/London.",
  ),
).annotate({ identifier: "Insights.TimeZone" })

export interface Query extends Schema.Schema.Type<typeof Query> {}
export const Query = Schema.Struct({
  spaceId: Space.ID,
  from: Schema.DateTimeUtc,
  to: Schema.DateTimeUtc.annotate({ description: "The end of the range, not included." }),
  timezone: TimeZone.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed("UTC"))).annotate({
    description: "Sets the edges of hour, day and week buckets.",
  }),
  groupBy: GroupBy.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed("none" as const))),
  userId: Schema.optional(Schema.Array(Auth.UserID)).annotate({
    description: "Usage of these people, and tasks that they own.",
  }),
  agent: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Usage of these agent names, and tasks assigned to these agents.",
  }),
  model: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Usage of these served models. Task numbers do not change.",
  }),
  payer: Schema.optional(Usage.Payer).annotate({ description: "Task numbers do not change." }),
  kind: Schema.optional(Usage.Kind).annotate({ description: "Task numbers do not change." }),
  orderBy: OrderBy.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed("cost" as const))).annotate({
    description: "Descending. Only for a grouping that is not time.",
  }),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: maximumLimit }))
    .pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(50)))
    .annotate({ description: "Only for a grouping that is not time." }),
})
  .check(
    Schema.makeFilter((query) => {
      const range = DateTime.distance(query.from, query.to)
      if (Duration.isLessThanOrEqualTo(range, Duration.zero)) return "from must be before to."
      if (Duration.isGreaterThan(range, maximumRange)) return "A range is at most 400 days."
      if (query.groupBy === "hour" && Duration.isGreaterThan(range, maximumHours))
        return "An hourly range is at most 400 hours."
      return true
    }),
  )
  .annotate({ identifier: "Insights.Query" })

export interface Tokens extends Schema.Schema.Type<typeof Tokens> {}
export const Tokens = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  reasoning: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number.annotate({ description: "Includes writes kept for 1 hour." }),
}).annotate({ identifier: "Insights.Tokens" })

export interface Cost extends Schema.Schema.Type<typeof Cost> {}
export const Cost = Schema.Struct({
  ren: Schema.Number.annotate({ description: "Provider cost that Ren pays, in millionths of a US dollar." }),
  customer: Schema.Number.annotate({
    description: "Provider cost on the organization’s own keys, in millionths of a US dollar.",
  }),
  unpricedCalls: Schema.Number.annotate({ description: "Model calls with no cost." }),
}).annotate({ identifier: "Insights.Cost" })

export interface Row extends Schema.Schema.Type<typeof Row> {}
export const Row = Schema.Struct({
  key: Schema.NullOr(Schema.String).annotate({
    description:
      "The bucket start (ISO, UTC), user ID, agent name, served model or provider. Null for the whole range and for usage that names no one.",
  }),
  label: Schema.NullOr(Schema.String).annotate({ description: "The user’s name, for a member row." }),
  sessions: Schema.Number.annotate({ description: "Root sessions that spent." }),
  calls: Schema.Number,
  errors: Schema.Number,
  tokens: Tokens,
  cost: Cost,
  tasksDone: Schema.NullOr(Schema.Number).annotate({
    description: "Tasks done now, at their latest move to done. Null for model and provider rows.",
  }),
  prsMerged: Schema.NullOr(Schema.Number).annotate({ description: "Null for model and provider rows." }),
  prsLinked: Schema.NullOr(Schema.Number).annotate({ description: "Null for model and provider rows." }),
}).annotate({ identifier: "Insights.Row" })

export interface Result extends Schema.Schema.Type<typeof Result> {}
export const Result = Schema.Struct({ rows: Schema.Array(Row) }).annotate({ identifier: "Insights.Result" })
