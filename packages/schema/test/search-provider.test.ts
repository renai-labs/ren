import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Models } from "../src/models.js"

test("an endpoint's search providers have unique IDs, and its catalog entry carries no key", () => {
  const endpoint = {
    id: "ren",
    protocol: "openai-chat",
    baseUrl: "https://llm.ren.test/v1",
    apiKey: { key: "secret" },
    models: [],
    search: [{ id: "ren/search", name: "Search" }],
  }
  expect(Schema.decodeUnknownSync(Models.Catalog)({ endpoints: [endpoint] })).toEqual({
    endpoints: [
      { id: "ren", protocol: "openai-chat", baseUrl: "https://llm.ren.test/v1", models: [], search: endpoint.search },
    ],
  })
  expect(() =>
    Schema.decodeUnknownSync(Models.Catalog)({
      endpoints: [
        {
          ...endpoint,
          search: [
            { id: "same", name: "One" },
            { id: "same", name: "Two" },
          ],
        },
      ],
    }),
  ).toThrow()
})
