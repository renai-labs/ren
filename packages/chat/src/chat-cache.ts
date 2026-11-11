export * as ChatCache from "./chat-cache.js"

import type { SessionMessage } from "@ren/schema/session/message"
import type { Effect } from "effect"

export const turnLimit = 20

export const writeDelay = "2 seconds"

export interface Cache {
  readonly read: Effect.Effect<ReadonlyArray<SessionMessage.Info> | undefined>
  readonly write: (messages: ReadonlyArray<SessionMessage.Info>) => Effect.Effect<void>
}

export const newestTurns = (messages: ReadonlyArray<SessionMessage.Info>, limit = turnLimit) => {
  const starts = messages.flatMap((message, index) =>
    message.type === "user" || message.type === "shell" ? [index] : [],
  )
  return starts.length <= limit ? messages : messages.slice(starts.at(-limit))
}
