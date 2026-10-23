export * as HarnessStorage from "./harness-storage.js"

import { Context, Effect, Layer, Schema } from "effect"
import { BrainStorage } from "./brain-storage.js"

const versionKey = "ren:harness-version"

const flushedKey = "ren:flushed-version"

export class Service extends Context.Service<Service, { readonly clear: Effect.Effect<void> }>()(
  "@ren/cell/HarnessStorage",
) {}

const Names = Schema.Array(Schema.Struct({ type: Schema.String, name: Schema.String }))

export const layerDurableObject = (storage: DurableObjectStorage) =>
  Layer.succeed(
    Service,
    Service.of({
      clear: Effect.sync(() => {
        const found = Schema.decodeUnknownSync(Names)([
          ...storage.sql.exec(
            "select type, name from sqlite_master where type in ('table', 'view') and name not like '\\_%' escape '\\' and name not like 'sqlite\\_%' escape '\\' order by rowid desc",
          ),
        ])
        for (const entry of found) storage.sql.exec(`drop ${entry.type} if exists "${entry.name}"`)
      }),
    }),
  )

// oxlint-disable-next-line ren/no-comments -- Runs before the harness opens its database. The database of another harness version is cleared only when that version flushed sync, so Postgres holds every chat (E100).
export const prepare = Effect.fnUntraced(function* (version: string) {
  const storage = yield* BrainStorage.Service
  const harness = yield* Service
  const stored = yield* Effect.promise(() => storage.get(versionKey))
  const flushed = yield* Effect.promise(() => storage.get(flushedKey))
  if (stored && stored !== version && flushed === stored) {
    yield* Effect.logInfo(`The harness moves from version ${stored} to ${version}; its database is cleared`)
    yield* harness.clear
  }
  yield* Effect.promise(() => storage.put(versionKey, version))
  yield* Effect.promise(() => storage.delete(flushedKey))
})

// oxlint-disable-next-line ren/no-comments -- Only after a flush that drained, with no request open, so nothing changes before the next boot.
export const flushed = (version: string) =>
  Effect.flatMap(BrainStorage.Service, (storage) => Effect.promise(() => storage.put(flushedKey, version)))
