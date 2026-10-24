import { describe, expect } from "bun:test"
import { Testing } from "@ren/db/testing"
import { Brain } from "@ren/schema/brain"
import { Signature } from "@ren/schema/signature"
import { ConfigProvider, Effect, Layer, Redacted, Schema } from "effect"
import { CredentialCallers } from "../src/credential-callers.js"
import { Signer } from "../src/signer.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const key = await Effect.runPromise(Signature.generate("brain"))

const it = testEffect(
  CredentialCallers.layer.pipe(
    Layer.provideMerge(Signer.layerLocal),
    Layer.provideMerge(Testing.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          BRAIN_KEYS: JSON.stringify([
            { id: key.privateKey.id, key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(key.privateKey.key) },
          ]),
        }),
      ),
    ),
  ),
)

const brain = Effect.fnUntraced(function* () {
  const owner = yield* Seed.owner()
  const brainId = Brain.ID.create()
  yield* Seed.session({ ...owner, brainId })
  return { organizationId: owner.organizationId, brainId }
})

describe("CredentialCallers", () => {
  it.live("a proxy login verifies as its workload; a wrong password or an unknown login does not", () =>
    Effect.gen(function* () {
      const callers = yield* CredentialCallers.Service
      const seeded = yield* brain()
      const workload = { kind: "brain" as const, id: seeded.brainId, generation: 1 }
      const placement = yield* callers.issue({ workload, organizationId: seeded.organizationId }, "ProxyLogin")
      if (placement.kind !== "ProxyLogin") return yield* Effect.die(new Error("expected a proxy login"))
      const verified = yield* callers.verify({
        kind: "ProxyLogin",
        username: placement.username,
        password: placement.password,
      })
      expect(verified).toEqual({ ok: true, caller: { workload, organizationId: seeded.organizationId } })
      const wrong = yield* callers.verify({
        kind: "ProxyLogin",
        username: placement.username,
        password: Redacted.make("not-it"),
      })
      expect(wrong).toEqual({ ok: false, reason: "unknown_workload" })
      expect(yield* callers.verify({ kind: "ProxyLogin", username: "nobody", password: placement.password })).toEqual({
        ok: false,
        reason: "unknown_workload",
      })
      expect(yield* callers.verify({ kind: "Login", username: placement.username })).toEqual({
        ok: true,
        caller: { workload, organizationId: seeded.organizationId },
      })
      expect(yield* callers.verify({ kind: "Login", username: "nobody" })).toEqual({
        ok: false,
        reason: "unknown_workload",
      })
    }),
  )

  it.live("a token verifies as its workload, and a token of another key does not", () =>
    Effect.gen(function* () {
      const callers = yield* CredentialCallers.Service
      const seeded = yield* brain()
      const workload = { kind: "brain" as const, id: seeded.brainId, generation: 1 }
      const placement = yield* callers.issue({ workload, organizationId: seeded.organizationId }, "Token")
      if (placement.kind !== "Token") return yield* Effect.die(new Error("expected a token"))
      expect(yield* callers.verify({ kind: "Token", token: Redacted.value(placement.token) })).toEqual({
        ok: true,
        caller: { workload, organizationId: seeded.organizationId },
      })
      const other = yield* Signature.generate("brain")
      const forged = yield* Signature.sign(other.privateKey, {
        scope: "caller",
        kind: "brain",
        id: seeded.brainId,
        gen: 1,
        org: seeded.organizationId,
        exp: Math.floor(Date.now() / 1000) + 60,
      })
      expect(yield* callers.verify({ kind: "Token", token: forged })).toEqual({ ok: false, reason: "unknown_workload" })
    }),
  )

  it.live("after a replace, the old generation's proofs get generation_retired", () =>
    Effect.gen(function* () {
      const callers = yield* CredentialCallers.Service
      const seeded = yield* brain()
      const caller = (generation: number) => ({
        workload: { kind: "brain" as const, id: seeded.brainId, generation },
        organizationId: seeded.organizationId,
      })
      const other = yield* brain()
      const tokenCaller = (generation: number) => ({
        workload: { kind: "brain" as const, id: other.brainId, generation },
        organizationId: other.organizationId,
      })
      const old = yield* callers.issue(caller(1), "ProxyLogin")
      const oldToken = yield* callers.issue(tokenCaller(1), "Token")
      const current = yield* callers.issue(caller(2), "ProxyLogin")
      yield* callers.issue(tokenCaller(2), "Token")
      if (old.kind !== "ProxyLogin" || current.kind !== "ProxyLogin" || oldToken.kind !== "Token")
        return yield* Effect.die(new Error("expected placements"))
      expect(yield* callers.verify({ kind: "ProxyLogin", username: old.username, password: old.password })).toEqual({
        ok: false,
        reason: "generation_retired",
      })
      expect(yield* callers.verify({ kind: "Token", token: Redacted.value(oldToken.token) })).toEqual({
        ok: false,
        reason: "generation_retired",
      })
      expect(
        yield* callers.verify({ kind: "ProxyLogin", username: current.username, password: current.password }),
      ).toEqual({ ok: true, caller: caller(2) })
      const revoked = yield* callers.revoke({ kind: "brain", id: seeded.brainId })
      expect(revoked.logins).toEqual([current.username])
      expect(
        yield* callers.verify({ kind: "ProxyLogin", username: current.username, password: current.password }),
      ).toEqual({ ok: false, reason: "generation_retired" })
    }),
  )
})
