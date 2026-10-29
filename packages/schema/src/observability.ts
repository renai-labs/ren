export * as Observability from "./observability.js"

import { Effect, Layer, type LogLevel, Option, Tracer } from "effect"

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
  chatSend: operation(
    "chat.send",
    "A message that Ren sends to a brain for a channel, a task, a schedule, the CLI or the SDK. The app sends to the brain directly.",
  ),
  sessionStart: operation(
    "session.start",
    "Starting a chat on its brain: a new chat, or a chat that the brain lost and restores.",
  ),
  brainRun: operation("brain.run", "A brain's sandbox reaching ready: create, resume, wake, boot or replace."),
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

export const layer = (minimum: LogLevel.LogLevel) =>
  Layer.mergeAll(Layer.succeed(Tracer.CurrentTraceLevel, "Debug"), Layer.succeed(Tracer.MinimumTraceLevel, minimum))
