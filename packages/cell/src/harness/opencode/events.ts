export * as OpenCodeEvents from "./events.js"

import { Effect, Option, Schema, Stream } from "effect"
import { Sse } from "effect/encoding"

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

export const stream = (fetch: (request: Request) => Promise<Response>) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise((signal) =>
        fetch(new Request("http://opencode/api/event", { signal })),
      ).pipe(Effect.orDie)
      if (!response.ok) return yield* Effect.fail(new Error(`OpenCode's event stream answered ${response.status}`))
      const body = response.body
      if (!body) return yield* Effect.die(new Error("OpenCode's event stream has no body"))
      return Stream.fromReadableStream({
        evaluate: () => body,
        onError: (cause) => new Error("OpenCode's event stream failed", { cause }),
      }).pipe(
        Stream.decodeText,
        Stream.pipeThroughChannel(Sse.decode()),
        Stream.mapError((cause) =>
          cause instanceof Error ? cause : new Error("OpenCode's event stream failed", { cause }),
        ),
        Stream.mapEffect((event) =>
          Option.match(decodeJson(event.data), {
            onNone: () => Effect.as(Effect.logWarning("Skipped an OpenCode event that is not JSON", event.data), []),
            onSome: (decoded) => Effect.succeed([decoded]),
          }),
        ),
        Stream.flattenIterable,
      )
    }),
  )
