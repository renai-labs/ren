import { describe, expect } from "bun:test"
import { Testing } from "@ren/db/testing"
import { Bundle } from "@ren/schema/bundle"
import { Signature } from "@ren/schema/signature"
import { ConfigProvider, Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Bundles } from "../src/bundles.js"
import { Signer } from "../src/signer.js"
import { testEffect } from "./lib/effect.js"

const key = await Effect.runPromise(Signature.generate("brain"))

const it = testEffect(Testing.layer)

const info = (kind: Bundle.Kind, version: string): Bundle.Info => ({ kind, version, sha256: "0".repeat(64) })

// oxlint-disable-next-line ren/no-comments -- One Ren server, built with the bundles of manifest, on the test's database.
const server = Effect.fnUntraced(function* (manifest: Bundle.Manifest) {
  const directory = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "ren-bundles-"))),
    (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
  )
  yield* Effect.promise(() =>
    Bun.write(join(directory, "manifest.json"), JSON.stringify(Schema.encodeSync(Bundle.Manifest)(manifest))),
  )
  const context = yield* Layer.build(
    Bundles.layer.pipe(
      Layer.provide(Signer.layerLocal),
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            REN_BUNDLES: directory,
            BRAIN_KEYS: JSON.stringify([
              { id: key.privateKey.id, key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(key.privateKey.key) },
            ]),
          }),
        ),
      ),
    ),
  )
  return { bundles: Context.get(context, Bundles.Service), directory }
})

describe("Bundles", () => {
  it.live(
    "a later build moves the current bundles forward; a server rolled back to an earlier build moves them to the one it has (EN29, chaos row 17)",
    () =>
      Effect.gen(function* () {
        const older = {
          builtAt: DateTime.makeUnsafe("2026-11-06T10:00:00Z"),
          bundles: [info("brain", "aaaaaaaaaaaaaaaa")],
        }
        const newer = {
          builtAt: DateTime.makeUnsafe("2026-11-06T11:00:00Z"),
          bundles: [info("brain", "bbbbbbbbbbbbbbbb")],
        }
        const current = (manifest: Bundle.Manifest) =>
          Effect.map(
            Effect.flatMap(server(manifest), (found) => found.bundles.current("brain")),
            Option.map((found) => found.version),
          )
        expect([yield* current(older), yield* current(newer), yield* current(newer), yield* current(older)]).toEqual([
          Option.some("aaaaaaaaaaaaaaaa"),
          Option.some("bbbbbbbbbbbbbbbb"),
          Option.some("bbbbbbbbbbbbbbbb"),
          Option.some("aaaaaaaaaaaaaaaa"),
        ])
      }),
  )

  it.live("a token gets the one bundle it names, from a server that has it", () =>
    Effect.gen(function* () {
      const brain = info("brain", "cccccccccccccccc")
      const found = yield* server({ builtAt: DateTime.makeUnsafe("2026-11-06T12:00:00Z"), bundles: [brain] })
      const token = yield* found.bundles.token(brain)
      expect(yield* found.bundles.file(token, brain)).toBe(join(found.directory, Bundle.fileOf(brain)))
      const other = info("executor", "cccccccccccccccc")
      expect((yield* Effect.flip(found.bundles.file(token, other)))._tag).toBe("Bundles.NotFound")
      expect((yield* Effect.flip(found.bundles.file(yield* found.bundles.token(other), other)))._tag).toBe(
        "Bundles.NotFound",
      )
      expect((yield* Effect.flip(found.bundles.file("not a token", brain)))._tag).toBe("Bundles.NotFound")
    }),
  )
})
