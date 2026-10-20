import { expect, test } from "bun:test"
import { Auth } from "@ren/schema/auth"
import { Session } from "@ren/schema/session"
import { Effect, Option } from "effect"
import { TestClock } from "effect/testing"
import { SessionToken } from "../src/session-token.js"

const keys = [
  { id: "active", secret: "active-secret-of-at-least-32-chars" },
  { id: "retiring", secret: "retiring-secret-of-at-least-32-chars" },
] as const
const now = 1_800_000_000
const claims = { sid: Session.ID.create(), scope: "client", exp: now + 60 } as const
const sign = (key: SessionToken.Key = keys[0]) => Effect.runPromise(SessionToken.sign(key, claims))
const verify = (token: string, millis = now * 1000) =>
  Effect.runPromise(
    TestClock.setTime(millis).pipe(Effect.andThen(SessionToken.verify(keys, token)), Effect.provide(TestClock.layer())),
  )

test.each([{ scope: "client" }, { scope: "host", org: Auth.OrganizationID.create(), iat: now }] as const)(
  "signs and verifies %j with the active key until its expiry",
  async (scope) => {
    const scoped = { ...claims, ...scope }
    const token = await Effect.runPromise(SessionToken.sign(keys[0], scoped))
    expect(await verify(token, scoped.exp * 1000 - 1)).toEqual(Option.some({ kid: "active", ...scoped }))
    expect(await verify(token, scoped.exp * 1000)).toEqual(Option.none())
  },
)

test("accepts the retiring key during rotation", async () => {
  expect(await verify(await sign(keys[1]))).toEqual(Option.some({ kid: "retiring", ...claims }))
})

test("rejects an unknown key id", async () => {
  expect(await verify(await sign({ ...keys[0], id: "removed" }))).toEqual(Option.none())
})

test("rejects a tampered payload or a signature from another secret", async () => {
  const token = await sign()
  const changed = await Effect.runPromise(SessionToken.sign(keys[0], { ...claims, scope: "server" }))
  expect(await verify(`${changed.slice(0, changed.indexOf("."))}${token.slice(token.indexOf("."))}`)).toEqual(
    Option.none(),
  )
  expect(await verify(await sign({ ...keys[0], secret: keys[1].secret }))).toEqual(Option.none())
})

test("rejects extra token segments rather than ignoring them", async () => {
  const token = await sign()
  expect(await verify(`${token}.extra`)).toEqual(Option.none())
})

test.each([{ scope: "host" }, { scope: "debug" }])(
  "rejects signed host claims that do not match the contract: %j",
  async (invalid) => {
    const token = await Effect.runPromise(SessionToken.seal(keys[0].secret, { kid: "active", ...claims, ...invalid }))
    expect(await verify(token)).toEqual(Option.none())
  },
)
