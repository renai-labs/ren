import { expect, test } from "bun:test"
import { Members } from "../src/features/members/members.js"

test("pasted addresses split on commas, semicolons and whitespace, deduplicated", () => {
  expect(Members.parseEmails("Ada@Example.com, grace@example.com;\nada@example.com  nope")).toEqual({
    valid: ["ada@example.com", "grace@example.com"],
    invalid: ["nope"],
  })
  expect(Members.parseEmails("  \n ")).toEqual({ valid: [], invalid: [] })
})
