export * as SqliteReader from "./sqlite-reader.js"

import { Database } from "bun:sqlite"
import { Effect } from "effect"
import type { OpenCodeSync } from "./opencode-sync.js"

export const make = (path: string) =>
  Effect.acquireRelease(
    Effect.sync(() => new Database(path, { readonly: true })),
    (database) => Effect.sync(() => database.close()),
  ).pipe(
    Effect.map((database): OpenCodeSync.Reader => ({
      read: (read) =>
        database.transaction(() => read((sql, ...bindings) => database.query(sql).iterate(...bindings)))(),
    })),
  )
