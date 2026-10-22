export * as SessionDrafts from "./session-drafts.js"

import { Composer } from "@ren/chat"
import { Session } from "@ren/schema/session"
import { Schema } from "effect"
import type { Platform } from "../../platform/platform.js"

export const fresh = "new"

export const history = "history"

export const key = (sessionID: Session.ID) => `session.${sessionID}`

// oxlint-disable-next-line ren/no-comments -- A new chat's first message stays here until the chat has started, so Retry after a failed start can send it again (E84).
export const pending = (sessionID: Session.ID) => `session.${sessionID}.pending`

const FirstMessage = Schema.fromJsonString(Session.FirstMessage)

export const keepPending = (drafts: Platform.Storage | undefined, sessionID: Session.ID, message: Session.FirstMessage) =>
  drafts?.set(pending(sessionID), Schema.encodeSync(FirstMessage)(message))

export const takePending = (drafts: Platform.Storage | undefined, sessionID: Session.ID) =>
  Schema.decodeUnknownOption(FirstMessage)(drafts?.get(pending(sessionID)))

export function prefill(drafts: Platform.Storage | undefined, draft: string, text: string) {
  const encoded = Composer.encode(Composer.fromHistory(Composer.decode(drafts?.get(draft)), { text, pasted: [] }))
  if (encoded) drafts?.set(draft, encoded)
}
