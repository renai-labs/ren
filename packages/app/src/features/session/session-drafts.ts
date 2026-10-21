export * as SessionDrafts from "./session-drafts.js"

import { Composer } from "@ren/chat"
import type { Session } from "@ren/schema/session"
import type { Platform } from "../../platform/platform.js"

export const fresh = "new"

export const history = "history"

export const key = (sessionID: Session.ID) => `session.${sessionID}`

export function prefill(drafts: Platform.Storage | undefined, draft: string, text: string) {
  const encoded = Composer.encode(Composer.fromHistory(Composer.decode(drafts?.get(draft)), { text, pasted: [] }))
  if (encoded) drafts?.set(draft, encoded)
}
