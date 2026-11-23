export * as History from "./history.js"

import { SessionMessage } from "@ren/schema/session/message"
import { SessionModel } from "@ren/schema/session/model"
import { Schema, Struct } from "effect"
import type { Mirror } from "./mirror.js"

export interface Local {
  readonly id: string
  readonly type: string
  readonly error?: unknown
  readonly time: { readonly created: unknown; readonly completed?: unknown }
}

const encode = Schema.encodeSync(SessionMessage.Info)

export const model = (ref: SessionModel.Ref, providerID: string) => ({
  providerID,
  id: SessionModel.key(ref),
  ...(ref.variant && ref.variant !== "default" && { variant: ref.variant }),
})

export const isSettled = (message: SessionMessage.Info) => {
  if (message.type === "assistant") return Boolean(message.time.completed)
  if (message.type === "shell" || message.type === "compaction") return message.status !== "running"
  return true
}

export const current = (messages: ReadonlyArray<SessionMessage.Info>) =>
  messages.findLast(
    (message): message is SessionMessage.Assistant | SessionMessage.ModelSwitched =>
      message.type === "assistant" || message.type === "model-switched",
  )?.model

export const toOpenCode = (message: SessionMessage.Info, providerID: string, speaker?: Mirror.Speaker) => {
  const encoded = encode(message)
  return json(encoded.type === "user" ? user(encoded, speaker) : reshape(encoded, providerID))
}

const json = Schema.decodeUnknownSync(Schema.MutableJson)

const user = (encoded: typeof SessionMessage.User.Encoded, speaker: Mirror.Speaker | undefined) => {
  const text = encoded.presentation?.displayText ?? encoded.text
  return {
    ...Struct.omit(encoded, ["presentation", "uploads", "sender", "channel", "schedule", "webhook", "task"]),
    text: speaker?.prefix ? `${speaker.prefix}: ${text}` : text,
    metadata: {
      ...(speaker?.userId && { userID: speaker.userId }),
      ...(speaker?.userName && { userName: speaker.userName }),
      remote: true,
    },
  }
}

const reshape = (encoded: typeof SessionMessage.Info.Encoded, providerID: string): Schema.Json => {
  if (encoded.type === "assistant")
    return {
      ...encoded,
      model: model(encoded.model, providerID),
      content: encoded.content.map((content) => (content.type === "text" ? Struct.omit(content, ["time"]) : content)),
    }
  if (encoded.type === "model-switched")
    return {
      ...encoded,
      model: model(encoded.model, providerID),
      ...(encoded.previous && { previous: model(encoded.previous, providerID) }),
    }
  if (encoded.type !== "compaction" || encoded.status === "failed") return encoded
  return {
    ...Struct.omit(encoded, ["recent"]),
    ...(encoded.status === "completed" && encoded.model && { model: model(encoded.model, providerID) }),
  }
}

export const behind = (ren: ReadonlyArray<SessionMessage.Info>, local: ReadonlyArray<Local>) => {
  const settled = ren.filter(isSettled)
  const ids = new Set(local.map((message) => message.id))
  const anchor = settled.findLastIndex((message) => ids.has(message.id))
  if (anchor < 0) return settled.length > 0
  const after = settled.slice(anchor + 1)
  const position = local.findIndex((message) => message.id === settled[anchor]?.id)
  const mine = local.slice(position + 1)
  const has = (messages: ReadonlyArray<{ readonly type: string }>, type: string) =>
    messages.some((message) => message.type === type)
  return (
    has(after, "user") ||
    has(after, "synthetic") ||
    (has(after, "assistant") && !has(mine, "assistant")) ||
    (has(after, "compaction") && !has(mine, "compaction"))
  )
}

export const unsent = (ren: ReadonlyArray<SessionMessage.Info>, local: ReadonlyArray<Local>) => {
  const ids = new Set<string>(ren.map((message) => message.id))
  return local
    .slice(
      local.findLastIndex(
        (message) => message.type === "assistant" && Boolean(message.time.completed) && !message.error,
      ) + 1,
    )
    .filter((message) => message.type === "user" && !ids.has(message.id))
}
