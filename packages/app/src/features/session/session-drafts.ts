export * as SessionDrafts from "./session-drafts.js"

import { Composer } from "@ren/chat"
import type { Session } from "@ren/schema/session"
import type { Platform } from "../../platform/platform.js"

export const fresh = "new"

export const key = (sessionID: Session.ID) => `session.${sessionID}`

export function restore(platform: Platform.Info, sessionID: Session.ID, text: string) {
  const encoded = Composer.encode(
    Composer.fromHistory(Composer.decode(platform.drafts?.get(key(sessionID))), { text, pasted: [] }),
  )
  if (encoded) platform.drafts?.set(key(sessionID), encoded)
}

export function prefill(drafts: Platform.Storage, text: string) {
  const encoded = Composer.encode(Composer.fromHistory(Composer.decode(drafts.get(fresh)), { text, pasted: [] }))
  if (encoded) drafts.set(fresh, encoded)
}
