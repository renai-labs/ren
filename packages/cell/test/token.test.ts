import { describe, expect, test } from "bun:test"
import { Effect, Option } from "effect"
import { Base64Url } from "effect/encoding"
import { TestClock } from "effect/testing"
import { Token } from "../src/token.js"
import { TestToken } from "./lib/token.js"

const now = 1_800_000_000
const payload = { kid: "active", sid: "ses_one", scope: "client", exp: now + 60 } as const

const sign = (body: unknown, secret: string = TestToken.keys[0].secret) => TestToken.sign(secret, body)

const verify = (token: string, millis = now * 1000) =>
  Effect.runPromise(
    TestClock.setTime(millis).pipe(
      Effect.andThen(Token.verify(TestToken.keys, token)),
      Effect.option,
      Effect.provide(TestClock.layer()),
    ),
  )

const verifyAll = (tokens: ReadonlyArray<string>) => Promise.all(tokens.map((token) => verify(token)))

const rejected = (tokens: ReadonlyArray<string>) => tokens.map(() => Option.none())

const signature = (token: string) => token.slice(token.indexOf(".") + 1)

describe("verify", () => {
  test("accepts a token signed with the active key and returns its kid, sid, scope and exp", async () => {
    expect(await verify(await sign(payload))).toEqual(Option.some(payload))
  })

  test("accepts a token signed with any listed key, so an old key keeps working during a rotation", async () => {
    const retiring = { ...payload, kid: "retiring" }
    expect(await verify(await sign(retiring, TestToken.keys[1].secret))).toEqual(Option.some(retiring))
  })

  test("rejects a token whose kid is not listed", async () => {
    expect(await verify(await sign({ ...payload, kid: "removed" }))).toEqual(Option.none())
  })

  test("rejects a token signed with a different secret under a listed kid", async () => {
    expect(await verify(await sign(payload, "a-different-secret-of-32-characters"))).toEqual(Option.none())
  })

  test("rejects a token whose payload changed after signing", async () => {
    const changed = await sign({ ...payload, sid: "ses_two" })
    const token = `${changed.slice(0, changed.indexOf("."))}.${signature(await sign(payload))}`
    expect(await verify(token)).toEqual(Option.none())
  })

  test("rejects a token whose signature was cut short or extended", async () => {
    const token = await sign(payload)
    const tokens = [token.slice(0, -1), `${token}AAAA`]
    expect(await verifyAll(tokens)).toEqual(rejected(tokens))
  })

  test("rejects a token at its exp second and after it, and accepts it the millisecond before", async () => {
    const token = await sign({ ...payload, exp: now })
    expect(await verify(token, now * 1000 - 1)).toEqual(Option.some({ ...payload, exp: now }))
    const times = [now * 1000, now * 1000 + 1, (now + 3600) * 1000]
    expect(await Promise.all(times.map((millis) => verify(token, millis)))).toEqual(times.map(() => Option.none()))
  })

  test("rejects a token without exactly one dot, or with an empty part", async () => {
    const token = await sign(payload)
    const head = token.slice(0, token.indexOf("."))
    const tokens = ["", ".", head, `${token}.${signature(token)}`, `.${signature(token)}`, `${head}.`]
    expect(await verifyAll(tokens)).toEqual(rejected(tokens))
  })

  test("rejects parts that are not base64url: padding, + or /, or other characters", async () => {
    const token = await sign(payload)
    const tokens = [`${token}=`, token.replace(".", "=."), `${token}+`, `/${token}`, `${token} `, `${token}%`]
    expect(await verifyAll(tokens)).toEqual(rejected(tokens))
  })

  test("rejects a payload that is not JSON", async () => {
    const token = `${Base64Url.encode("{not json")}.${signature(await sign(payload))}`
    expect(await verify(token)).toEqual(Option.none())
  })

  test("rejects a payload without kid, sid, scope or exp", async () => {
    const tokens = await Promise.all(
      Object.keys(payload).map((field) =>
        sign(Object.fromEntries(Object.entries(payload).filter((entry) => entry[0] !== field))),
      ),
    )
    expect(await verifyAll(tokens)).toEqual(rejected(tokens))
  })

  test("rejects a scope other than server or client", async () => {
    expect(await verify(await sign({ ...payload, scope: "admin" }))).toEqual(Option.none())
  })

  test("rejects an exp that is not a whole number of seconds", async () => {
    const tokens = await Promise.all([now + 0.5, String(now + 60), null].map((exp) => sign({ ...payload, exp })))
    expect(await verifyAll(tokens)).toEqual(rejected(tokens))
  })

  test("rejects a sid that is not a session id", async () => {
    const tokens = await Promise.all(["one", "", "msg_one", 1].map((sid) => sign({ ...payload, sid })))
    expect(await verifyAll(tokens)).toEqual(rejected(tokens))
  })

  test("ignores unknown payload fields", async () => {
    expect(await verify(await sign({ ...payload, extra: true }))).toEqual(Option.some(payload))
  })
})

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
