import { describe, expect, test } from "bun:test"
import { Session } from "@ren/schema/session"
import { Effect, Option } from "effect"
import { Base64Url } from "effect/encoding"
import { TestClock } from "effect/testing"
import { SessionToken } from "../src/session-token.js"

const keys = [
  { id: "active", secret: "active-secret-of-at-least-32-chars" },
  { id: "retiring", secret: "retiring-secret-of-at-least-32-chars" },
] as const

const now = 1_800_000_000
const payload = { kid: "active", sid: Session.ID.make("ses_one"), scope: "client", exp: now + 60 } as const

const sign = (body: unknown, secret: string = keys[0].secret) => Effect.runPromise(SessionToken.seal(secret, body))

const verify = (token: string, millis = now * 1000) =>
  Effect.runPromise(
    TestClock.setTime(millis).pipe(
      Effect.andThen(SessionToken.verify(keys, token)),
      Effect.option,
      Effect.provide(TestClock.layer()),
    ),
  )

const verifyAll = (tokens: ReadonlyArray<string>) => Promise.all(tokens.map((token) => verify(token)))

const rejected = (tokens: ReadonlyArray<string>) => tokens.map(() => Option.none())

const signature = (token: string) => token.slice(token.indexOf(".") + 1)

describe("sign", () => {
  test("signs the claims under the key's id, and verify reads them back", async () => {
    const token = await Effect.runPromise(
      SessionToken.sign(keys[1], { sid: payload.sid, scope: "server", exp: payload.exp }),
    )
    expect(await verify(token)).toEqual(Option.some({ ...payload, kid: "retiring", scope: "server" }))
  })
})

describe("verify", () => {
  test("accepts a token signed with the active key and returns its kid, sid, scope and exp", async () => {
    expect(await verify(await sign(payload))).toEqual(Option.some(payload))
  })

  test("accepts a token signed with any listed key, so an old key keeps working during a rotation", async () => {
    const retiring = { ...payload, kid: "retiring" }
    expect(await verify(await sign(retiring, keys[1].secret))).toEqual(Option.some(retiring))
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
