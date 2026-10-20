import { expect, test } from "bun:test"
import { Effect, Option, Schema } from "effect"
import { TestClock } from "effect/testing"
import { SignJWT } from "jose"
import { Signature } from "../src/signature.js"

const active = await Effect.runPromise(Signature.generate("active"))
const retiring = await Effect.runPromise(Signature.generate("retiring"))
const keys = [active.publicKey, retiring.publicKey]
const now = 1_800_000_000
const Claims = Schema.Struct({ kid: Schema.String, sub: Schema.String, exp: Schema.Int })
const claims = { sub: "subject", exp: now + 60 }
const sign = (key = active.privateKey, payload: Parameters<typeof Signature.sign>[1] = claims) =>
  Effect.runPromise(Signature.sign(key, payload))
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

test("expires exactly at the claimed expiry", async () => {
  const token = await sign()
  expect(await verify(token, claims.exp * 1000 - 1)).toEqual(Option.some({ kid: "active", ...claims }))
  expect(await verify(token, claims.exp * 1000)).toEqual(Option.none())
})

test("rejects a token without an expiry", async () => {
  const subtle = await crypto.subtle.importKey("pkcs8", new Uint8Array(active.privateKey.key), "Ed25519", false, [
    "sign",
  ])
  const token = await new SignJWT({ sub: "subject" }).setProtectedHeader({ alg: "EdDSA", kid: "active" }).sign(subtle)
  expect(await verify(token)).toEqual(Option.none())
})

test("round-trips generated keys through their variables", () => {
  const signing = Schema.encodeSync(Signature.PrivateKeys)([active.privateKey])
  const published = Schema.encodeSync(Signature.PublicKeys)([active.publicKey])
  expect(Schema.decodeUnknownSync(Signature.PrivateKeys)(signing)).toEqual([active.privateKey])
  expect(Schema.decodeUnknownSync(Signature.PublicKeys)(published)).toEqual([active.publicKey])
})
