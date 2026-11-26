import { describe, expect, test } from "bun:test"
import type { SessionModel } from "@ren/schema/session/model"
import { ModelChoice } from "../src/model-choice.js"

const choice = (providerID: string, id: string, providerName?: string): SessionModel.Choice => ({
  id,
  providerID,
  name: id,
  variants: [],
  ...(providerName && { providerName }),
})

// oxlint-disable-next-line ren/no-comments -- D5: provider names come from the brain's list, never from a table in the client.
describe("ModelChoice", () => {
  test("a provider's name is the one the list gives, else its id capitalized", () => {
    const models = [choice("groq", "llama", "Groq Cloud"), choice("acme", "m1")]
    expect(ModelChoice.providerName("groq", models)).toBe("Groq Cloud")
    expect(ModelChoice.providerName("acme", models)).toBe("Acme")
  })

  test("a Ren model's vendor is the provider its id starts with", () => {
    expect(ModelChoice.vendorOf(choice("ren", "anthropic/claude-opus-5-5"))).toBe("anthropic")
    expect(ModelChoice.vendorOf(choice("openai", "gpt-6-luna"))).toBe("openai")
  })
})

// oxlint-disable-next-line ren/no-comments -- Providers F5: the composer keeps a chat's model that left the list until the person picks another.
describe("ModelChoice.forChat", () => {
  const models = [choice("groq", "llama")]
  test("a chat whose model left the list shows it as gone; a pick replaces it", () => {
    const chat = { id: "old", providerID: "groq" }
    expect(ModelChoice.forChat(models, { picked: undefined, saved: undefined, chat })).toEqual({
      model: chat,
      gone: true,
    })
    const picked = { id: "llama", providerID: "groq" }
    expect(ModelChoice.forChat(models, { picked, saved: undefined, chat })).toEqual({ model: picked, gone: false })
  })
})
