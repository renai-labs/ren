import { describe, expect, test } from "bun:test"
import { Composer } from "@ren/chat"
import { SessionDrafts } from "./session-drafts.js"

const storage = (entries: Readonly<Record<string, string>> = {}) => {
  const values = new Map(Object.entries(entries))
  return {
    values,
    get: (key: string) => values.get(key),
    set: (key: string, value: string) => void values.set(key, value),
    remove: (key: string) => void values.delete(key),
  }
}

describe("Session drafts", () => {
  test("a ?prompt= link replaces the new chat's text and keeps the model it picked", () => {
    const model = { id: "gpt", providerID: "openai" }
    const drafts = storage({
      [SessionDrafts.fresh]: Composer.encode({ text: "Old idea", pasted: [], model }) ?? "",
    })
    SessionDrafts.prefill(drafts, "Summarise the open pull requests")
    expect(Composer.decode(drafts.values.get(SessionDrafts.fresh))).toEqual({
      text: "Summarise the open pull requests",
      pasted: [],
      model,
    })
  })
})
