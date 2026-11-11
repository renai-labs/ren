import { expect, test } from "bun:test"
import { Option } from "effect"
import { Token } from "../src/token.js"
import { TestToken } from "./lib/token.js"

test.each<[string, string | null, Option.Option<string>]>([
  ["the password of Basic auth is the token", TestToken.basic("token"), Option.some("token")],
  ["any user name is accepted", TestToken.basic("token", "someone"), Option.some("token")],
  ["an empty user name is accepted", TestToken.basic("token", ""), Option.some("token")],
  ["no header has no token", null, Option.none()],
  ["a Bearer token is not read", "Bearer token", Option.none()],
  ["an empty password has no token", TestToken.basic(""), Option.none()],
  ["invalid Base64 has no token", "Basic !!!", Option.none()],
  ["a credential without a colon has no token", `Basic ${btoa("token")}`, Option.none()],
])("%s", (_name, authorization, expected) => {
  expect(Token.read(authorization)).toEqual(expected)
})
