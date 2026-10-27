export * as Schedule from "./schedule.js"

import { DateTime, Duration, Effect, Option, Schema } from "effect"
import { Agent } from "./agent.js"
import { Auth } from "./auth.js"
import { Identifier } from "./identifier.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import { Session } from "./session.js"
import { Space } from "./space.js"

export const ID = Identifier.make("sch", "Schedule.ID")
export type ID = typeof ID.Type

export const maximumMessageLength = 20_000

export const Cron = Schema.String.check(
  Schema.makeFilter((cron) => {
    const fields = cron.trim().split(/\s+/u)
    return (
      (fields.length === 5 && fields.every((field) => /^[0-9A-Za-z*,/?#-]+$/u.test(field))) ||
      'Use a cron expression with five fields, for example "0 9 * * *".'
    )
  }),
).annotate({ identifier: "Schedule.Cron" })

export const TimeZone = Schema.String.check(
  Schema.makeFilter(
    (zone) => Option.isSome(DateTime.zoneMakeNamed(zone)) || 'Use an IANA time zone, for example "Europe/Berlin".',
  ),
).annotate({ identifier: "Schedule.TimeZone" })

export const Message = Schema.Trim.check(
  Schema.isNonEmpty({ message: "Message is required." }),
  Schema.isMaxLength(maximumMessageLength, { message: `Use ${maximumMessageLength} characters or fewer.` }),
).annotate({ identifier: "Schedule.Message" })

export interface Recurring extends Schema.Schema.Type<typeof Recurring> {}
export const Recurring = Schema.Struct({
  cron: Cron,
  timeZone: TimeZone,
  until: Schema.optionalKey(Schema.DateTimeUtc).annotate({ description: "The last time it may run." }),
}).annotate({ identifier: "Schedule.Recurring" })

export interface Once extends Schema.Schema.Type<typeof Once> {}
export const Once = Schema.Struct({ at: Schema.DateTimeUtc }).annotate({ identifier: "Schedule.Once" })

export const When = Schema.Union([
  Schema.Struct({
    cron: Schema.String,
    timeZone: Schema.String,
    until: Schema.optionalKey(Schema.DateTimeUtc).annotate({ description: "The last time it may run." }),
  }),
  Once,
]).annotate({
  identifier: "Schedule.When",
  description: "A cron in a time zone, or one time.",
})
export type When = typeof When.Type

export const WhenInput = Schema.Union([
  Recurring,
  Once,
  Schema.Struct({
    in: Schema.DurationFromString.annotate({ description: "A delay from now, such as “30 minutes”." }),
  }),
]).annotate({
  identifier: "Schedule.WhenInput",
  description: "A cron in a time zone, one time, or a delay from now. Ren stores a delay as one time.",
})
export type WhenInput = typeof WhenInput.Type

export const Target = Schema.Union([Schema.Literal("new-chat"), Schema.Struct({ sessionId: Session.ID })]).annotate({
  identifier: "Schedule.Target",
  description: "`new-chat` starts a chat at each run. A session ID sends the message to that chat.",
})
export type Target = typeof Target.Type

export const TargetInput = Schema.Union([
  Schema.Literal("new-chat"),
  Schema.Literal("this-chat"),
  Schema.Struct({ sessionId: Session.ID }),
]).annotate({
  identifier: "Schedule.TargetInput",
  description:
    "`new-chat` starts a chat at each run. `this-chat` sends the message to the chat of the agent that calls; a person cannot use it. A session ID sends the message to that chat.",
})
export type TargetInput = typeof TargetInput.Type

export const Status = Schema.Literals(["active", "paused", "ended"]).annotate({ identifier: "Schedule.Status" })
export type Status = typeof Status.Type

export const PauseReason = Schema.Literals(["user", "owner_left", "agent_removed", "failing"]).annotate({
  identifier: "Schedule.PauseReason",
  description:
    "`user`: a person paused it. `owner_left`: its owner left the space. `agent_removed`: its agent left the space. `failing`: its last 5 runs failed.",
})

export const maximumActive = 50

export const minimumInterval = Duration.minutes(5)

export const failuresToPause = 5
export type PauseReason = typeof PauseReason.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  spaceId: Space.ID,
  slug: Primitive.Slug.annotate({
    description: "Unique among the live schedules of its space. A new name does not change it.",
  }),
  name: Schema.String,
  agentId: Schema.NullOr(Agent.ID).annotate({ description: "Null: a new chat gets the space’s default settings." }),
  when: When,
  target: Target,
  message: Schema.String,
  ownerId: Auth.UserID.annotate({
    description: "The person who last wrote its instruction. Each run sends the message as this person.",
  }),
  status: Status,
  pausedReason: Schema.NullOr(PauseReason),
  nextRunAt: Schema.NullOr(Schema.DateTimeUtc),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  archivedAt: Schema.NullOr(Schema.DateTimeUtc),
}).annotate({ identifier: "Schedule.Info" })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  spaceId: Schema.optional(Space.ID).annotate({ description: "Without it, the schedules of every space you are in." }),
  status: Schema.optional(Status),
  search: Schema.optional(Schema.String).annotate({ description: "Part of the name or the message." }),
  ...Pagination.fields(50),
}).annotate({ identifier: "Schedule.ListInput" })

const Page = Pagination.Page(Info).annotate({ identifier: "Schedule.Page" })

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({
  spaceId: Space.ID,
  name: Primitive.Name,
  slug: Schema.optional(Primitive.Slug).annotate({
    description: "Without it, Ren makes one from the name and adds -2, -3, … when it is taken.",
  }),
  message: Message,
  when: WhenInput,
  target: Schema.optional(TargetInput).annotate({ description: "Without it, `new-chat`." }),
  agentId: Schema.optional(Agent.ID).annotate({
    description: "An agent of the space for a new chat. Without it, the space’s default settings.",
  }),
}).annotate({ identifier: "Schedule.CreateInput" })

export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}
export const UpdateInput = Schema.Struct({
  name: Schema.optional(Primitive.Name),
  message: Schema.optional(Message),
  when: Schema.optional(WhenInput),
  target: Schema.optional(TargetInput),
  agentId: Schema.optional(Schema.NullOr(Agent.ID)),
}).annotate({
  identifier: "Schedule.UpdateInput",
  description: "A change to the message, the agent, the target or the time makes you its owner.",
})

const NoInput = Schema.Struct({}).annotate({ identifier: "Schedule.NoInput" })

export const Declaration = Schema.Struct({
  agent: Schema.optionalKey(Agent.Name.annotate({ description: "Without it, the space’s default settings." })),
  cron: Cron,
  timeZone: TimeZone,
  message: Message,
  until: Schema.optionalKey(Schema.DateTimeUtcFromString.annotate({ description: "The last time it runs, in UTC." })),
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(true))),
}).annotate({ identifier: "Schedule.Declaration" })
export interface Declaration extends Schema.Schema.Type<typeof Declaration> {}

export const definition = Primitive.define({
  name: "schedule",
  plural: "schedules",
  id: ID,
  info: Info,
  list: { input: ListInput, page: Page },
  get: true,
  create: { input: CreateInput, result: Info },
  update: { input: UpdateInput, result: Info },
  archive: true,
  actions: {
    pause: { input: NoInput, result: Info },
    resume: { input: NoInput, result: Info },
    run: { input: NoInput, result: Info },
  },
})
