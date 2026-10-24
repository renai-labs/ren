import { describe, expect, test } from "bun:test"
import { authorizationQuery } from "./web.js"

const signed = new URLSearchParams([
  ["response_type", "code"],
  ["client_id", "https://client.example/oauth/client.json"],
  ["state", "123"],
  ["exp", "1792852181"],
  ["ba_param", "client_id"],
  ["ba_param", "exp"],
  ["ba_param", "response_type"],
  ["ba_param", "state"],
  ["sig", "duBEN+iHsF7MuZJH1UqtumMMHBVLLpQcyoYlhslSsMo="],
])

const sorted = (query: string | undefined) => [...new URLSearchParams(query).entries()].map(String).toSorted()

describe("authorizationQuery", () => {
  test("keeps the signed query that the server sent", () => {
    expect(sorted(authorizationQuery(`?${signed}`))).toEqual(sorted(signed.toString()))
  })

  test("restores the signed query after the router rewrote repeated and number-like values as JSON", () => {
    const rewritten = new URLSearchParams([
      ["response_type", "code"],
      ["client_id", "https://client.example/oauth/client.json"],
      ["state", '"123"'],
      ["exp", "1792852181"],
      ["ba_param", JSON.stringify(signed.getAll("ba_param"))],
      ["sig", "duBEN+iHsF7MuZJH1UqtumMMHBVLLpQcyoYlhslSsMo="],
    ])
    expect(sorted(authorizationQuery(`?${rewritten}`))).toEqual(sorted(signed.toString()))
  })

  test("is undefined for a page that has no signed authorization request", () => {
    expect(authorizationQuery("?redirect=%2Fspaces")).toBeUndefined()
  })
})
