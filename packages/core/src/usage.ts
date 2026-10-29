export * as Usage from "./usage.js"

import { timingSafeEqual } from "node:crypto"
import { Database } from "@ren/db/database"
import { Usage } from "@ren/schema/usage"
import { Config, Context, DateTime, Effect, Layer, Option, Redacted, Schema } from "effect"

export { Batch, Event, Recorded, headers } from "@ren/schema/usage"

export class Forbidden extends Schema.TaggedError<Forbidden>()("Usage.Forbidden", { message: Schema.String }) {}

export class Unavailable extends Schema.TaggedError<Unavailable>()("Usage.Unavailable", {
  message: Schema.String,
}) {}

export interface Interface {
  readonly authenticate: (key: Redacted.Redacted) => Effect.Effect<Option.Option<string>>
  readonly record: (
    producer: string,
    events: ReadonlyArray<Usage.Event>,
  ) => Effect.Effect<Usage.Recorded, Forbidden | Unavailable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Usage") {}

const events = Database.Schema.usage_event

const digest = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest()

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const key = yield* Config.option(Config.Redacted("USAGE_INGEST_KEY"))
    const unavailable = () => new Unavailable({ message: "The usage store is not available." })

    return Service.of({
      authenticate: (given) =>
        Effect.succeed(
          key.pipe(
            Option.filter((expected) =>
              timingSafeEqual(digest(Redacted.value(given)), digest(Redacted.value(expected))),
            ),
            Option.as("ren-inference"),
          ),
        ),
      record: Effect.fn("Usage.record")(
        function* (producer: string, batch: ReadonlyArray<Usage.Event>) {
          const foreign = batch.find((event) => event.source !== producer)
          if (foreign)
            return yield* new Forbidden({ message: `The key of ${producer} cannot send events of ${foreign.source}.` })
          return yield* database.db.transaction((transaction) =>
            Effect.gen(function* () {
              const inserted = yield* transaction
                .insert(events)
                .values(
                  batch.map((event) => ({
                    source: event.source,
                    id: event.id,
                    type: event.type,
                    time: DateTime.toDateUtc(event.time),
                    workload: event.workload,
                    organization: event.organization,
                    brain: event.brain,
                    space: event.space,
                    root_session: event.root_session,
                    session: event.session,
                    turn: event.turn,
                    member: event.member,
                    agent: event.agent,
                    kind: event.kind,
                    requested_model: event.requested_model,
                    variant: event.variant,
                    payer: event.payer,
                    provider: event.provider,
                    served_model: event.served_model,
                    input_tokens: event.input_tokens,
                    output_tokens: event.output_tokens,
                    reasoning_tokens: event.reasoning_tokens,
                    cache_read_tokens: event.cache_read_tokens,
                    cache_write_tokens: event.cache_write_tokens,
                    cache_write_1h_tokens: event.cache_write_1h_tokens,
                    cost_micro_usd: event.cost_micro_usd,
                    latency_ms: event.latency_ms,
                    time_to_first_token_ms: event.time_to_first_token_ms,
                    stop_reason: event.stop_reason,
                    error: event.error,
                  })),
                )
                .onConflictDoNothing()
                .returning({ source: events.source, id: events.id })
              return { inserted: inserted.length }
            }),
          )
        },
        Effect.catchTags({
          EffectDrizzleQueryError: (error) => Effect.logError(error).pipe(Effect.andThen(Effect.fail(unavailable()))),
          SqlError: (error) => Effect.logError(error).pipe(Effect.andThen(Effect.fail(unavailable()))),
        }),
      ),
    })
  }),
)
