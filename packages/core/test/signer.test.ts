import { describe, expect } from "bun:test"
import { Signature } from "@ren/schema/signature"
import { ConfigProvider, Effect, Layer, Option, Schema } from "effect"
import { Signer } from "../src/signer.js"
import { testEffect } from "./lib/effect.js"

const active = await Effect.runPromise(Signature.generate("brain-2026-10"))
const next = await Effect.runPromise(Signature.generate("brain-2026-11"))

const encode = (key: Signature.PrivateKey) => ({
  id: key.id,
  key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(key.key),
})

const Claims = Schema.Struct({ kid: Schema.String, sub: Schema.String, exp: Schema.Int })

const it = testEffect(
  Signer.layerLocal.pipe(
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          BRAIN_KEYS: JSON.stringify([encode(next.privateKey), encode(active.privateKey)]),
        }),
      ),
    ),
  ),
)

describe("Signer.layerLocal", () => {
  it.live("a token checks with the purpose's public keys; a new key signs only for a holder that has it", () =>
    Effect.gen(function* () {
      const signer = yield* Signer.Service
      const keys = yield* signer.publicKeys("brain")
      expect(keys.map((key) => key.id)).toEqual(["brain-2026-11", "brain-2026-10"])
      const exp = Math.floor(Date.now() / 1000) + 60
      const old = yield* signer.sign("brain", { sub: "brn_1", exp }, { holders: ["brain-2026-10"] })
      const current = yield* signer.sign(
        "brain",
        { sub: "brn_1", exp },
        { holders: ["brain-2026-10", "brain-2026-11"] },
      )
      expect(Option.map(yield* Signature.verify(keys, Claims, old), (claims) => claims.kid)).toEqual(
        Option.some("brain-2026-10"),
      )
      expect(Option.map(yield* Signature.verify(keys, Claims, current), (claims) => claims.kid)).toEqual(
        Option.some("brain-2026-11"),
      )
      const missing = yield* Effect.flip(signer.publicKeys("environment"))
      expect(missing._tag).toBe("Signer.Unavailable")
    }),
  )
})
