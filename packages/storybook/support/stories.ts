import type { APIRequestContext } from "@playwright/test"
import { readdir } from "fs/promises"
import { Schema } from "effect"

export const testPort = 6116

export const prefixes = { ui: "ui-", parity: "parity-" }

const StorybookIndex = Schema.Struct({
  entries: Schema.Record(Schema.String, Schema.Struct({ id: Schema.String, type: Schema.String })),
})

export async function storyComponents(directory: string) {
  const files = await readdir(directory)
  return files.filter((file) => file.endsWith(".stories.tsx")).map((file) => file.replace(".stories.tsx", ""))
}

export async function storyIds(request: APIRequestContext, prefix: string, component: string) {
  const index = Schema.decodeUnknownSync(StorybookIndex)(await (await request.get("/index.json")).json())
  return Object.values(index.entries)
    .filter((entry) => entry.type === "story" && entry.id.startsWith(`${prefix}${component}--`))
    .map((entry) => entry.id)
}
