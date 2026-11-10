import { expect, test } from "bun:test"
import { Models } from "../src/models.js"

test("catalog lookup matches only the exact provider and model", () => {
  const lookup = Models.lookup({
    endpoints: [
      {
        id: "ren",
        protocol: "openai-chat",
        baseUrl: "https://llm.ren.test/v1",
        models: [
          { id: "openai/chat", type: "chat", protocol: "openai-chat" },
          { id: "anthropic/claude", type: "chat", protocol: "anthropic-messages" },
        ],
      },
      {
        id: "openai",
        protocol: "openai-chat",
        baseUrl: "https://api.openai.test/v1",
        models: [{ id: "chat", type: "chat", protocol: "openai-chat" }],
      },
    ],
  })
  expect(lookup({ providerID: "openai", id: "chat" })?.ref).toEqual({ providerID: "openai", id: "chat" })
  expect(lookup({ providerID: "ren", id: "openai/chat" })?.ref).toEqual({ providerID: "ren", id: "openai/chat" })
  expect(lookup({ providerID: "openai", id: "openai/chat" })).toBeUndefined()
  expect(lookup({ providerID: "ren", id: "chat" })).toBeUndefined()
  expect(lookup({ providerID: "anthropic", id: "claude" })).toBeUndefined()
})
