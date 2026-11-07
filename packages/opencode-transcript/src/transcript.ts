export * as OpenCodeTranscript from "./transcript.js"

import { Sync } from "@ren/schema/sync"
import { Array, Effect, Option, Schema } from "effect"
import { OpenCodeRows } from "./opencode-rows.js"
import { Translate } from "./translate.js"

const decodeRow = Schema.decodeUnknownEffect(Sync.OpenCodeMessageRow)

export const messages = (rows: ReadonlyArray<unknown>) =>
  Effect.forEach(rows, (row) =>
    decodeRow(row).pipe(
      Effect.flatMap(OpenCodeRows.message),
      Effect.flatMap((info) => Effect.fromOption(Translate.message(info))),
      Effect.map(Option.some),
      Effect.catch((error) =>
        Effect.logError("A saved OpenCode message cannot be shown; the history leaves it out", error).pipe(
          Effect.as(Option.none()),
        ),
      ),
    ),
  ).pipe(Effect.map(Array.getSomes))
