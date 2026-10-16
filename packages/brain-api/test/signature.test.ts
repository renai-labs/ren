import { expect, test } from "bun:test"
import { Effect, Option, Schema } from "effect"
import { TestClock } from "effect/testing"
import type { JWTPayload } from "jose"
import { Signature } from "../src/signature.js"

const active = await Effect.runPromise(Signature.generate("active"))
const retiring = await Effect.runPromise(Signature.generate("retiring"))
const keys = [active.publicKey, retiring.publicKey]
const now = 1_800_000_000
const Claims = Schema.Struct({ kid: Schema.String, sub: Schema.String, exp: Schema.Int })
const claims = { sub: "subject", exp: now + 60 }
const sign = (key = active.privateKey, payload: JWTPayload = claims) => Effect.runPromise(Signature.sign(key, payload))
const verify = (token: string, millis = now * 1000) =>
  Effect.runPromise(
    TestClock.setTime(millis).pipe(
      Effect.andThen(Signature.verify(keys, Claims, token)),
      Effect.provide(TestClock.layer()),
    ),
  )

test("signs and verifies with the active key", async () => {
  expect(await verify(await sign())).toEqual(Option.some({ kid: "active", ...claims }))
})

test("accepts the retiring key during rotation", async () => {
  expect(await verify(await sign(retiring.privateKey))).toEqual(Option.some({ kid: "retiring", ...claims }))
})

test("rejects an unknown key id", async () => {
  expect(await verify(await sign({ ...active.privateKey, id: "removed" }))).toEqual(Option.none())
})

test("rejects a key id that names a different key", async () => {
  expect(await verify(await sign({ ...retiring.privateKey, id: "active" }))).toEqual(Option.none())
})

test("rejects a tampered payload", async () => {
  const token = await sign()
  const changed = await sign(active.privateKey, { ...claims, sub: "other" })
  expect(await verify([token.split(".")[0], changed.split(".")[1], token.split(".")[2]].join("."))).toEqual(
    Option.none(),
  )
})

test("signs a standard three segment JWT with a pinned EdDSA header", async () => {
  const token = await sign()
  const [header, payload] = token.split(".")
  expect(token.split(".")).toHaveLength(3)
  expect(JSON.parse(Buffer.from(header ?? "", "base64url").toString())).toEqual({ alg: "EdDSA", kid: "active" })
  expect(JSON.parse(Buffer.from(payload ?? "", "base64url").toString())).toEqual(claims)
})

test("takes the key id from the protected header, not the payload", async () => {
  expect(await verify(await sign(active.privateKey, { ...claims, kid: "retiring" }))).toEqual(
    Option.some({ kid: "active", ...claims }),
  )
})

test("rejects a token whose header algorithm is not EdDSA", async () => {
  const header = Buffer.from(JSON.stringify({ alg: "none", kid: "active" })).toString("base64url")
  const [, payload, signature] = (await sign()).split(".")
  expect(await verify(`${header}.${payload}.${signature}`)).toEqual(Option.none())
  expect(await verify(`${header}.${payload}.`)).toEqual(Option.none())
})

test("rejects a token without a header key id", async () => {
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA" })).toString("base64url")
  const [, payload, signature] = (await sign()).split(".")
  expect(await verify(`${header}.${payload}.${signature}`)).toEqual(Option.none())
})

test("rejects malformed tokens", async () => {
  expect(await verify("")).toEqual(Option.none())
  expect(await verify("not-a-token")).toEqual(Option.none())
  expect(await verify("a.b.c")).toEqual(Option.none())
})

test("rejects claims that do not decode", async () => {
  expect(await verify(await sign(active.privateKey, { exp: claims.exp }))).toEqual(Option.none())
})

test("expires exactly at the claimed expiry", async () => {
  const token = await sign()
  expect(await verify(token, claims.exp * 1000 - 1)).toEqual(Option.some({ kid: "active", ...claims }))
  expect(await verify(token, claims.exp * 1000)).toEqual(Option.none())
})

test("rejects extra token segments rather than ignoring them", async () => {
  expect(await verify(`${await sign()}.extra`)).toEqual(Option.none())
})

test("rejects a token without an expiry", async () => {
  expect(await verify(await sign(active.privateKey, { sub: "subject" }))).toEqual(Option.none())
})

test("round-trips generated keys through their variables", () => {
  const signing = Schema.encodeSync(Signature.SigningKey)(active.privateKey)
  const published = Schema.encodeSync(Signature.PublicKeys)([active.publicKey])
  expect(Schema.decodeUnknownSync(Signature.SigningKey)(signing)).toEqual(active.privateKey)
  expect(Schema.decodeUnknownSync(Signature.PublicKeys)(published)).toEqual([active.publicKey])
})

test("rejects keys of the wrong length, duplicate ids and an empty key list", () => {
  const published = (value: unknown) => Schema.decodeUnknownOption(Signature.PublicKeys)(JSON.stringify(value))
  expect(published([{ id: "short", key: "AAAA" }])).toEqual(Option.none())
  expect(published([])).toEqual(Option.none())
  const encoded = Schema.encodeSync(Signature.PublicKey)(active.publicKey)
  expect(published([encoded, encoded])).toEqual(Option.none())
  expect(
    Schema.decodeUnknownOption(Signature.SigningKey)(
      JSON.stringify(Schema.encodeSync(Signature.PublicKey)(active.publicKey)),
    ),
  ).toEqual(Option.none())
})
