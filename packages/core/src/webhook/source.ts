export * as WebhookSource from "./source.js"

import type { Database } from "@ren/db/database"
import { Webhook } from "@ren/schema/webhook"
import { DateTime, Effect, Option, Schema, Struct } from "effect"

type Row = typeof Database.Schema.webhook.$inferSelect

export type App = Pick<
  typeof Database.Schema.app.$inferSelect,
  "id" | "name" | "webhooks" | "archived_at" | "updated_at"
>

const decodeParser = Schema.decodeUnknownEffect(Webhook.Parser)

export const of = Effect.fnUntraced(function* (row: Row) {
  if (row.app_id && row.preset)
    return { _tag: "preset", appId: row.app_id, preset: row.preset } satisfies Webhook.Source
  if (!row.name || !row.message || !row.parser)
    return yield* Effect.die(new Error(`Webhook ${row.id} has neither a preset nor its own parser`))
  return {
    _tag: "custom",
    name: row.name,
    message: row.message,
    parser: yield* decodeParser(row.parser).pipe(Effect.orDie),
  } satisfies Webhook.Source
})

export const parserOf = (preset: Webhook.Preset): Webhook.Parser =>
  Struct.pick(preset, ["signature", "handshake", "signedHandshake", "filter", "eventId", "threadKey", "title"])

export interface Current {
  readonly name: string
  readonly message: string | null
  readonly parser: Webhook.Parser | null
  readonly preset: Webhook.PresetOf | null
}

export const current = (source: Webhook.Source, app: Option.Option<App>): Current => {
  if (source._tag === "custom")
    return { name: source.name, message: source.message, parser: source.parser, preset: null }
  const found = Option.flatMap(
    Option.filter(app, (each) => !each.archived_at),
    (each) => Option.fromNullishOr(each.webhooks[source.preset]),
  )
  return {
    name: Option.match(found, { onNone: () => source.preset, onSome: (preset) => preset.name }),
    message: Option.match(found, { onNone: () => null, onSome: (preset) => preset.message }),
    parser: Option.match(found, { onNone: () => null, onSome: parserOf }),
    preset: Option.match(app, {
      onNone: () => null,
      onSome: (each) => ({
        appId: each.id,
        appName: each.name,
        preset: source.preset,
        secret: Option.match(found, { onNone: () => null, onSome: (preset) => preset.secret }),
        setup: Option.match(found, { onNone: () => null, onSome: (preset) => preset.setup }),
        updatedAt: DateTime.fromDateUnsafe(each.updated_at),
      }),
    }),
  }
}
