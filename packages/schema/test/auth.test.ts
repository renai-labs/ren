import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Auth } from "../src/index.js"

describe("Auth.User", () => {
  test("decodes a Better Auth user and drops fields it doesn't carry", () => {
    const id = Auth.UserID.create()
    const user = Schema.decodeUnknownSync(Auth.User)({
      id,
      name: "Ada",
      email: "ada@example.com",
      emailVerified: false,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    expect(user).toEqual({ id, name: "Ada", email: "ada@example.com", emailVerified: false, image: null })
  })

  test("rejects a user without a prefixed ID", () => {
    expect(() =>
      Schema.decodeUnknownSync(Auth.User)({
        id: "abc",
        name: "Ada",
        email: "ada@example.com",
        emailVerified: false,
        image: null,
      }),
    ).toThrow()
  })
})
