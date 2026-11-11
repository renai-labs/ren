import { describe, expect } from "bun:test"
import { Bundle } from "@ren/schema/bundle"
import { ConfigProvider, Context, Effect, Layer, Option } from "effect"
import { Bundles } from "../src/bundles.js"
import { TestBundles } from "./lib/bundles.js"
import { testEffect } from "./lib/effect.js"

const it = testEffect(Layer.empty)

const bundlesWith = Effect.fnUntraced(function* (config: Readonly<Record<string, string>>) {
  const context = yield* Layer.build(
    Bundles.layer.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(config)))),
  )
  return Context.get(context, Bundles.Service)
})

describe("Bundles", () => {
  it.live("a Ren with no bundle bucket has no current bundles, so its machines run the code they hold", () =>
    Effect.gen(function* () {
      const bundles = yield* bundlesWith({})
      expect(yield* bundles.current).toEqual(Option.none())
    }),
  )

  it.live("a bucket that no deploy has published to yet has no current bundles", () =>
    Effect.gen(function* () {
      const bucket = yield* TestBundles.bucket
      const bundles = yield* bundlesWith(bucket.config)
      expect(yield* bundles.current).toEqual(Option.none())
    }),
  )

  it.live(
    "the current bundles are the ones the deploy published; each download link fetches its archive, with the folder it unpacks into",
    () =>
      Effect.gen(function* () {
        const bucket = yield* TestBundles.bucket
        const archives = { dependencies: "deps", brain: "brain", executor: "executor" } as const
        const published = Bundle.kinds.map((kind, index) => ({
          kind,
          version: `${index}`.repeat(16),
          sha256: new Bun.CryptoHasher("sha256").update(archives[kind]).digest("hex"),
        }))
        yield* Effect.forEach(published, (bundle) => bucket.put(Bundle.keyOf(bundle), archives[bundle.kind]))
        yield* bucket.publish(published)
        const bundles = yield* bundlesWith(bucket.config)
        expect(yield* bundles.current).toEqual(Option.some(published))
        const downloads = yield* bundles.downloads(published)
        const fetched = yield* Effect.promise(() =>
          Promise.all(downloads.map((download) => fetch(download.url).then((response) => response.text()))),
        )
        expect({ fetched, trees: downloads.map((download) => download.tree) }).toEqual({
          fetched: ["deps", "brain", "executor"],
          trees: ["0000000000000000", "1111111111111111-0000000000000000", "2222222222222222-0000000000000000"],
        })
        expect([...new Set(downloads.map((download) => new URL(download.url).hostname))]).toEqual(
          Option.toArray(bundles.host),
        )
      }),
  )
})
