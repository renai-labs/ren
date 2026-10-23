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
