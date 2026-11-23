export * as Messages from "./messages.js"

import { SessionMessage } from "@ren/schema/session/message"
import { DateTime } from "effect"

const at = (offset: number) => DateTime.makeUnsafe(Date.UTC(2026, 10, 23, 9) + offset * 1000)

const model = { providerID: "stub", id: "stub-model" }

export const user = (offset: number, text: string, fields: Partial<SessionMessage.User> = {}): SessionMessage.User => ({
  id: SessionMessage.ID.create(),
  type: "user",
  text,
  time: { created: at(offset) },
  ...fields,
})

export const assistant = (
  offset: number,
  content: ReadonlyArray<SessionMessage.Content>,
  fields: Partial<SessionMessage.Assistant> = {},
): SessionMessage.Assistant => ({
  id: SessionMessage.ID.create(),
  type: "assistant",
  agent: "build",
  model,
  content,
  finish: "stop",
  cost: 0,
  tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: at(offset), completed: at(offset + 1) },
  ...fields,
})

export const text = (value: string): SessionMessage.Text => ({ type: "text", text: value })

export const tool = (offset: number): SessionMessage.Tool => ({
  type: "tool",
  id: "call_1",
  name: "read",
  executed: true,
  state: {
    status: "completed",
    input: { path: "notes.txt" },
    content: [{ type: "text", text: "the notes" }],
    metadata: { preview: "the notes", truncated: false },
  },
  time: { created: at(offset), ran: at(offset), completed: at(offset) },
})

export const idle = (offset: number): SessionMessage.Idle => ({
  id: SessionMessage.ID.create(),
  type: "idle",
  outcome: "succeeded",
  time: { created: at(offset) },
})

export const synthetic = (offset: number, value: string): SessionMessage.Synthetic => ({
  id: SessionMessage.ID.create(),
  type: "synthetic",
  text: value,
  time: { created: at(offset) },
})
