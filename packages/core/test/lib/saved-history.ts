export * as SavedHistory from "./saved-history.js"

import { Database } from "@ren/db/database"
import { SessionMessage } from "@ren/schema/session/message"
import { Effect } from "effect"
import { Seed } from "./seed.js"

export const saved = Effect.fnUntraced(function* (texts: ReadonlyArray<string>) {
  const database = yield* Database.Service
  const owner = yield* Seed.owner()
  const id = yield* Seed.session(owner)
  yield* database.db.insert(Database.Schema.opencode_message).values(
    texts.map((text, seq) => ({
      id: SessionMessage.ID.create(),
      session_id: id,
      type: "user",
      seq,
      data: JSON.stringify({ text, time: { created: 1_760_000_000_000 } }),
    })),
  )
  return { id, actor: { userId: owner.createdBy, organizationId: owner.organizationId, roles: ["owner"] } }
})
