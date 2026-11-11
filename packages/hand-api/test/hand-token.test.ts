import { expect, test } from "bun:test"
import { Brain } from "@ren/schema/brain"
import { Hand } from "@ren/schema/hand"
import { Effect, Option } from "effect"
import { TestClock } from "effect/testing"
import { HandToken } from "../src/hand-token.js"
import { Signature } from "@ren/schema/signature"

const pair = await Effect.runPromise(Signature.generate("active"))
const now = 1_800_000_000
const claims = { environment: Hand.ID.create(), brain: Brain.ID.create(), exp: now + 60 }
const verify = (token: string) =>
  Effect.runPromise(
    TestClock.setTime(now * 1000).pipe(
      Effect.andThen(HandToken.verify([pair.publicKey], token)),
      Effect.provide(TestClock.layer()),
    ),
  )

test("signs and verifies an environment token", async () => {
  const token = await Effect.runPromise(HandToken.sign(pair.privateKey, claims))
  expect(await verify(token)).toEqual(Option.some({ ...claims, typ: "environment", kid: "active" }))
})

test("never accepts a token of another type", async () => {
  const token = await Effect.runPromise(Signature.sign(pair.privateKey, { ...claims, typ: "brain" }))
  expect(await verify(token)).toEqual(Option.none())
})
