export * as ChannelEventRun from "./channel-event-run.js"

import { Channel } from "@ren/schema/channel"
import { Session } from "@ren/schema/session"
import { Effect, Layer, Schema } from "effect"
import { DurableRunner } from "./durable-runner.js"
import { Intake } from "./intake.js"

// oxlint-disable-next-line ren/no-comments -- The durable run of a channel event before Intake. Ren keeps its handler so that a run stored before the deploy still starts its chat, as a new Intake.Run. Remove it when no ChannelEvent run is left.
export const Run = DurableRunner.make("ChannelEvent", {
  payload: { event: Channel.Event, messageId: Session.MessageID, sessionId: Session.ID },
  idempotencyKey: (payload) => `${payload.event.provider}:${payload.event.install}:${payload.event.eventId}`,
})

const encode = Schema.encodeSync(Channel.Event)

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const intake = yield* Intake.Service
    yield* DurableRunner.register(Run, (payload) =>
      DurableRunner.supervise(Run.idempotencyKey(payload), intake.start(payload.event.provider, encode(payload.event))),
    )
  }),
)
