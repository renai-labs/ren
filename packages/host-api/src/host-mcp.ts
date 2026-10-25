export * as HostMcp from "./host-mcp.js"

import { Auth } from "@ren/schema/auth"
import { Session } from "@ren/schema/session"
import { Option, Schema } from "effect"

export const path = "/mcp"

// oxlint-disable-next-line ren/no-comments -- no x-ren- prefix: the egress removes x-ren-* headers from every request (credentials README row 24).
export const sessionHeader = "ren-session"

export const userHeader = "ren-user"

const decodeSession = Schema.decodeUnknownOption(Session.ID)

const decodeUser = Schema.decodeUnknownOption(Auth.UserID)

export interface Chat {
  readonly sessionId: Session.ID
  readonly userId: Auth.UserID | undefined
}

export const chatOf = (headers: Headers): Option.Option<Chat> => {
  const sessionId = decodeSession(headers.get(sessionHeader))
  const sender = headers.get(userHeader)
  if (Option.isNone(sessionId)) return Option.none()
  // ast-grep-ignore: no-nullish-comparison, -- an empty ren-user names no valid sender and is refused, not read as absent
  if (sender === null) return Option.some({ sessionId: sessionId.value, userId: undefined })
  return Option.map(decodeUser(sender), (userId) => ({ sessionId: sessionId.value, userId }))
}
