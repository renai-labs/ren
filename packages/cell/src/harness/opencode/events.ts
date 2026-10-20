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
        Stream.map((event) => decodeJson(event.data)),
        Stream.filter(Option.isSome),
        Stream.map((decoded) => decoded.value),
      )
    }),
  )
