export * as OpenCodeFixtures from "./fixtures.js"

import { Sync } from "@ren/schema/sync"
import { Schema } from "effect"

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
