import { describe, expect } from "bun:test"
import { Auth } from "@ren/schema/auth"
import { ConfigProvider, Effect, Exit, Layer, Redacted } from "effect"
import { Envelope } from "../src/envelope.js"
import { testEffect } from "./lib/effect.js"

const keys = (...ids: ReadonlyArray<string>) =>
  JSON.stringify(
    ids.map((id) => ({ id, key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url") })),
  )

const oldKeys = keys("local:2026-09")
const newKeys = keys("local:2026-10")

const local = (value: string) =>
  Envelope.layerLocal.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ ENVELOPE_KEYS: value }))))

const context = (id: string): Envelope.Context => ({
  organizationId: Auth.OrganizationID.make("org_01"),
  kind: "credential",
  id,
})

describe("Envelope", () => {
  testEffect(local(oldKeys)).effect("a sealed value opens only with the context it was sealed with", () =>
    Effect.gen(function* () {
      const envelope = yield* Envelope.Service
      const sealed = yield* envelope.seal(Redacted.make("sk_live_1"), context("crd_a"))
      expect(sealed.keyId).toBe("local:2026-09")
      expect(JSON.stringify(sealed)).not.toContain("sk_live_1")
      expect(Redacted.value(yield* envelope.open(sealed, context("crd_a")))).toBe("sk_live_1")
      const moved = yield* Effect.exit(envelope.open(sealed, context("crd_b")))
      expect(Exit.isFailure(moved) && JSON.stringify(moved.cause)).toContain("Envelope.Tampered")
    }),
  )

  testEffect(Layer.empty).effect("layerMove opens a row of the old keys and seals with the new keys", () =>
    Effect.gen(function* () {
      const old = yield* Envelope.Service.pipe(Effect.provide(local(oldKeys)))
      const sealed = yield* old.seal(Redacted.make("sk_live_1"), context("crd_a"))
      const move = yield* Envelope.Service.pipe(Effect.provide(Envelope.layerMove(local(oldKeys), local(newKeys))))
      expect(Redacted.value(yield* move.open(sealed, context("crd_a")))).toBe("sk_live_1")
      const rewrapped = yield* move.rewrap(sealed, context("crd_a"))
      expect(rewrapped.keyId).toBe("local:2026-10")
      expect(Redacted.value(yield* move.open(rewrapped, context("crd_a")))).toBe("sk_live_1")
      const fresh = yield* move.seal(Redacted.make("v2"), context("crd_b"))
      expect(fresh.keyId).toBe("local:2026-10")
    }),
  )
})
