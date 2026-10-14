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

  test("reads the Basic scheme in any letter case", () => {
    const credential = TestToken.basic("token").slice("Basic ".length)
    const schemes = ["basic", "BASIC", "bAsIc"]
    expect(schemes.map((scheme) => Token.read(`${scheme} ${credential}`))).toEqual(
      schemes.map(() => Option.some("token")),
    )
  })

  test("finds no token in a request without Authorization", () => {
    expect(Token.read(null)).toEqual(Option.none())
  })

  test("finds no token in Bearer", () => {
    expect(Token.read("Bearer token")).toEqual(Option.none())
  })

  test("finds no token in Basic with an empty password", () => {
    expect(Token.read(TestToken.basic(""))).toEqual(Option.none())
  })

  test("finds no token in another scheme, Basic that is not base64, or Basic without a colon", () => {
    const headers = ["Digest token", "Basic !!!", `Basic ${btoa("token")}`, "Basic", "Basic ", ""]
    expect(headers.map(Token.read)).toEqual(headers.map(() => Option.none()))
  })
})
