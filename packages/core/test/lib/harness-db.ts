export * as HarnessDb from "./harness-db.js"

import { Database } from "bun:sqlite"
import { join } from "node:path"

// oxlint-disable-next-line ren/no-comments -- Reads a local brain's harness database (OpenCode) directly, for tests that check what the brain keeps.
export const hasChat = (home: string, chat: string) => {
  const db = new Database(join(home, ".ren", "opencode.db"), { readonly: true })
  const found = db.query("select id from session_v2 where id = ?").all(chat)
  db.close()
  return found.length > 0
}

// oxlint-disable-next-line ren/no-comments -- Writes keys in a stopped local brain's brain.db, as an older brain version left them.
export const setBrainKeys = (home: string, values: Readonly<Record<string, string>>) => {
  const db = new Database(join(home, ".ren", "brain.db"))
  const upsert = db.query(
    "insert into kv (key, value) values (?, ?) on conflict (key) do update set value = excluded.value",
  )
  for (const entry of Object.entries(values)) upsert.run(entry[0], entry[1])
  db.close()
}

// oxlint-disable-next-line ren/no-comments -- Reads one key of a local brain's brain.db.
export const brainKey = (home: string, key: string) => {
  const db = new Database(join(home, ".ren", "brain.db"), { readonly: true })
  const found = db.query<{ value: string }, [string]>("select value from kv where key = ?").get(key)
  db.close()
  return found?.value
}

// oxlint-disable-next-line ren/no-comments -- Deletes keys in a stopped local brain's brain.db, as on a disk that never had them.
export const deleteBrainKeys = (home: string, keys: ReadonlyArray<string>) => {
  const db = new Database(join(home, ".ren", "brain.db"))
  const remove = db.query("delete from kv where key = ?")
  for (const key of keys) remove.run(key)
  db.close()
}
