export * as OpenCodeFixtures from "./fixtures.js"

import { SessionMessage } from "@opencode/schema/session-message"
import { SessionTransfer } from "@opencode/schema/session-transfer"
import { Sync } from "@ren/schema/sync"
import { Schema } from "effect"
import { OpenCodeRows } from "../../src/opencode-rows.js"

export interface Chat extends Schema.Schema.Type<typeof Chat> {}
export const Chat = Schema.Struct({
  session: Sync.OpenCodeSessionRow,
  messages: Schema.Array(Sync.OpenCodeMessageRow),
  inbox: Schema.Array(Sync.OpenCodeInboxRow),
})

export interface Recording extends Schema.Schema.Type<typeof Recording> {}
export const Recording = Schema.Struct({ version: Schema.String, chats: Schema.Array(Chat) })

export const directory = new URL("../fixtures/", import.meta.url).pathname

export const recordings = await Promise.all(
  [...new Bun.Glob("*.json").scanSync(directory)]
    .toSorted()
    .map(async (name) => Schema.decodeUnknownSync(Recording)(await Bun.file(`${directory}${name}`).json())),
)

// oxlint-disable-next-line ren/no-comments -- A recorded chat as OpenCode's HTTP API exports it (`GET /api/experimental/session/export`).
export const exported = (chat: Pick<Chat, "session" | "messages">): Schema.Json =>
  Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(
    JSON.stringify(
      Schema.encodeSync(Schema.toCodecJson(SessionTransfer.Data))({
        info: OpenCodeRows.session(chat.session),
        messages: chat.messages.map((row) => Schema.decodeUnknownSync(SessionMessage.Info)(OpenCodeRows.stored(row))),
      }),
    ),
  )
