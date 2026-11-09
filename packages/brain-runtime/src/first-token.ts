export * as FirstToken from "./first-token.js"

import { Duration, Effect, Stream } from "effect"

const outputs = new Set(["session.text.started", "session.reasoning.started", "session.tool.input.started"])

const ends = new Set(["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"])

const sessionOf = (event: { readonly data: object }) =>
  "sessionID" in event.data && typeof event.data.sessionID === "string" ? event.data.sessionID : undefined

export const durations =
  <RX>(options: { readonly isMain: (sessionID: string) => Effect.Effect<boolean, never, RX> }) =>
  <E, R>(events: Stream.Stream<{ readonly type: string; readonly created: number; readonly data: object }, E, R>) =>
    events.pipe(
      Stream.filterEffect((event) => {
        const sessionID = sessionOf(event)
        return event.type === "session.execution.started" && sessionID
          ? options.isMain(sessionID)
          : Effect.succeed(true)
      }),
      Stream.mapAccum(
        () => new Map<string, number>(),
        (started, event) => {
          const sessionID = sessionOf(event)
          if (!sessionID) return [started, []]
          if (event.type === "session.execution.started") return [new Map([...started, [sessionID, event.created]]), []]
          const start = started.get(sessionID)
          if (!start || !(outputs.has(event.type) || ends.has(event.type))) return [started, []]
          return [
            new Map([...started].filter((entry) => entry.at(0) !== sessionID)),
            outputs.has(event.type) ? [Duration.millis(event.created - start)] : [],
          ]
        },
      ),
    )
