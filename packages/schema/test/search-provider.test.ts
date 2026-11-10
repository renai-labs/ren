import { expect, test } from "bun:test"
import { Schema } from "effect"
import { SearchProvider } from "../src/search-provider.js"

test("a public search catalog strips credentials and rejects ambiguous provider IDs", () => {
  const decode = Schema.decodeUnknownSync(SearchProvider.Catalog)
  expect(decode({ providerID: "ren", providers: [], baseUrl: "https://example.com", apiKey: "secret" })).toEqual({
    providerID: "ren",
    providers: [],
  })
  expect(() =>
    decode({
      providerID: "ren",
      providers: [
        { id: "same", name: "One" },
        { id: "same", name: "Two" },
      ],
    }),
  ).toThrow()
})
