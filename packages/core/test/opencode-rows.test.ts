import { describe, expect } from "bun:test"
import { Testing } from "@ren/db/testing"
import { Effect, Layer } from "effect"
import { SessionSync } from "../src/session-sync.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"
import { SyncFixture } from "./lib/sync-fixture.js"

const it = testEffect(SessionSync.layer.pipe(Layer.provideMerge(Testing.layer)))

const tree = Effect.fnUntraced(function* () {
  const owner = yield* Seed.owner()
  const rootId = yield* Seed.session(owner)
  return { rootId, host: SyncFixture.host(owner.organizationId, rootId) }
})

describe("OpenCode rows in Postgres", () => {
  it.live(
    "Postgres text refuses a raw NUL in a plain column such as title, so the pass fails and Ren keeps nothing",
    () =>
      Effect.gen(function* () {
        const sync = yield* SessionSync.Service
        const { host, rootId } = yield* tree()
        const defect = yield* SyncFixture.pass(host, SyncFixture.session(rootId, { title: "a\u0000b" }), 2, []).pipe(
          Effect.as(undefined),
          Effect.catchDefect(Effect.succeed),
        )
        expect(defect).toMatchObject({
          _tag: "EffectDrizzleQueryError",
          cause: {
            reasons: [
              {
                error: {
                  reason: {
                    cause: { code: "22021", message: expect.stringMatching(/^invalid byte sequence .+: 0x00$/) },
                  },
                },
              },
            ],
          },
        })
        expect((yield* sync.restore(host, rootId)).map((chat) => chat.session)).toEqual([null])
      }),
  )
})
