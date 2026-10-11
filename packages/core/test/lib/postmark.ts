export * as Postmark from "./postmark.js"

import { Context, Effect, Layer, Queue, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"

const Message = Schema.fromJsonString(
  Schema.Struct({
    From: Schema.String,
    To: Schema.String,
    Subject: Schema.String,
    TextBody: Schema.String,
    MessageStream: Schema.String,
  }),
)

export interface Delivery {
  readonly token: string | undefined
  readonly message: typeof Message.Type
}

export class Outbox extends Context.Service<Outbox, { readonly next: Effect.Effect<Delivery> }>()(
  "test/Postmark/Outbox",
) {}

export const layer = (status = 200) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const deliveries = yield* Queue.unbounded<Delivery>()
      const client = HttpClient.make((request) =>
        Effect.gen(function* () {
          const body = request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : ""
          yield* Queue.offer(deliveries, {
            token: request.headers["x-postmark-server-token"],
            message: yield* Schema.decodeEffect(Message)(body).pipe(Effect.orDie),
          })
          return HttpClientResponse.fromWeb(request, Response.json({ ErrorCode: status === 200 ? 0 : 300 }, { status }))
        }),
      )
      return Context.make(HttpClient.HttpClient, client).pipe(
        Context.add(Outbox, Outbox.of({ next: Queue.take(deliveries) })),
      )
    }),
  )
