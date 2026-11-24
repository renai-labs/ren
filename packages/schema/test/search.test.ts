import { expect, test } from "bun:test"
import { Search } from "../src/search.js"

test("matches needs every word in one of the fields, in any case, and a blank search matches everything", () => {
  const fields = ["Fix the login page", "The signup link is broken", undefined] as const
  expect(Search.matches("  PAGE   broken ", ...fields)).toBe(true)
  expect(Search.matches("login signup", ...fields)).toBe(true)
  expect(Search.matches("login sso", ...fields)).toBe(false)
  expect(Search.matches("login page", "login", "page")).toBe(true)
  expect(Search.matches("   ", ...fields)).toBe(true)
})
