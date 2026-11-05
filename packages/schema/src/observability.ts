export * as Observability from "./observability.js"

import { Effect, Layer, type LogLevel, Metric, Option, Tracer } from "effect"

export interface Operation {
  readonly span: string
  readonly description: string
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>
}

const operation = (span: string, description: string): Operation =>
  Object.assign(
    <A, E, R>(self: Effect.Effect<A, E, R>) =>
      Effect.flatMap(Effect.option(Effect.currentParentSpan), (parent) =>
        self.pipe(
          Effect.provideService(Tracer.CurrentTraceLevel, "Info"),
          Effect.withSpan(span, {
            sampled: true,
            root: Option.match(parent, { onNone: () => true, onSome: (found) => !found.sampled }),
          }),
        ),
      ),
    { span, description },
  )

export const Trace = {
  chatOpen: operation(
    "chat.open",
    "Opening a chat: Ren finds the brain, wakes it if it sleeps, and signs the client's token.",
  ),
  chatPrompt: operation(
    "chat.prompt",
    "A message that a person sends from the app to a brain through the Chat API, until the brain accepts it.",
  ),
  chatSend: operation(
    "chat.send",
    "A message that Ren sends to a brain for a channel, a task, a schedule, the CLI or the SDK. The app sends to the brain directly.",
  ),
  sessionStart: operation(
    "session.start",
    "Starting a chat on its brain: a new chat, or a chat that the brain lost and restores.",
  ),
  brainRun: operation(
    "brain.run",
    "A brain's sandbox reaching ready: create, resume, wake, boot or replace. A run that started its brain names the kind in ren.brain.start_kind: new, resume or replace.",
  ),
  chatHistory: operation("chat.history", "A brain answering the first page of a chat's history."),
  chatRestore: operation(
    "chat.restore",
    "A brain restoring a chat that its sandbox does not have from Ren, before it answers the chat's first request.",
  ),
  environmentAssign: operation(
    "environment.assign",
    "Giving a session an environment at its first tool call, provisioning one when none has room.",
  ),
  connectorConnect: operation("connector.connect", "Starting to connect a connector: an OAuth app or an MCP provider."),
  connectorCallback: operation("connector.callback", "Finishing a connector's sign-in when the provider calls back."),
  channelEvent: operation(
    "channel.event",
    "A GitHub or Slack event, from Ren receiving it to the task or turn it starts.",
  ),
} as const

export const Metrics = {
  turnFirstToken: Metric.timer("ren.turn.first_token", {
    description:
      "A main chat’s turn, from its start to its first text, reasoning or tool call, as OpenCode timed them. A subagent’s turn is not timed.",
    boundaries: [
      100, 250, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10_000, 15_000, 20_000, 30_000, 60_000,
    ],
  }),
} as const

export const layer = (minimum: LogLevel.LogLevel) =>
  Layer.mergeAll(Layer.succeed(Tracer.CurrentTraceLevel, "Debug"), Layer.succeed(Tracer.MinimumTraceLevel, minimum))
