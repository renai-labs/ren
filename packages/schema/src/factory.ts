export * as Factory from "./factory.js"

import { Effect, Schema } from "effect"

export const maximumAgents = 64
export const defaultMaxHandoffs = 20

export const StartMode = Schema.Literals(["new", "continue"]).annotate({
  identifier: "Factory.StartMode",
})
export type StartMode = typeof StartMode.Type

const Max = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 })).annotate({
  description: "Handoffs on this edge before a person decides.",
})
const MaxRuns = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 })).annotate({
  description: "Runs of this agent before a person decides.",
})
const MaxHandoffs = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })).annotate({
  description: "Handoffs before a person decides.",
})

export interface Edge extends Schema.Schema.Type<typeof Edge> {}
export const Edge = Schema.Struct({
  agentId: Schema.String,
  max: Schema.optionalKey(Max),
  else: Schema.optionalKey(Schema.String.annotate({ description: "Gets the task at the max." })),
  start: Schema.optionalKey(StartMode),
}).annotate({ identifier: "Factory.Edge" })

export interface Entry extends Schema.Schema.Type<typeof Entry> {}
export const Entry = Schema.Struct({
  agentId: Schema.String,
  maxRuns: Schema.optionalKey(MaxRuns),
  to: Schema.optionalKey(
    Schema.Array(Edge).annotate({
      description: "The agents it can hand off to. Without it, any agent.",
    }),
  ),
}).annotate({ identifier: "Factory.Entry" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  maxHandoffs: MaxHandoffs.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(defaultMaxHandoffs))),
  agents: Schema.Array(Entry).check(
    Schema.isMaxLength(maximumAgents, { message: `A factory has at most ${maximumAgents} agents.` }),
  ),
}).annotate({
  identifier: "Factory.Info",
  description: "The space’s agents in board order, with their handoffs.",
})

export const empty: Info = { maxHandoffs: defaultMaxHandoffs, agents: [] }
