import { describe, expect } from "bun:test"
import { Testing } from "@ren/db/testing"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
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
  it.live("jsonb refuses JSON with \\u0000 or a lone \\ud800, so the OpenCode JSON columns are text", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const refusals = yield* Effect.forEach(
        [JSON.stringify({ output: "a\u0000b" }), JSON.stringify({ output: "a\ud800b" })],
        (json) => Effect.flip(sql`select ${json}::jsonb as value`),
      )
      expect(refusals.map((error) => error.reason.cause)).toMatchObject([
        {
          code: "22P05",
          message: "unsupported Unicode escape sequence",
          detail: "\\u0000 cannot be converted to text.",
        },
        {
          code: "22P02",
          message: "invalid input syntax for type json",
          detail: "Unicode low surrogate must follow a high surrogate.",
        },
      ])
    }),
  )

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
