import { describe, expect, test } from "bun:test"
import { Option } from "effect"
import { Token } from "../src/token.js"
import { TestToken } from "./lib/token.js"

describe("read", () => {
  test("reads the token from the password of Authorization: Basic, whatever the user name", () => {
    const users = ["opencode", "someone", ""]
    expect(users.map((user) => Token.read(TestToken.basic("token", user)))).toEqual(
      users.map(() => Option.some("token")),
    )
  })

  test("finds no token without a valid Basic password", () => {
    const headers = [null, "Bearer token", TestToken.basic(""), "Basic !!!", `Basic ${btoa("token")}`]
    expect(headers.map(Token.read)).toEqual(headers.map(() => Option.none()))
  })
})
