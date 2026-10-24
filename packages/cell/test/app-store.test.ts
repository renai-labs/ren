import { expect } from "bun:test"
import { testEffect } from "@ren/executor/testing"
import { AppCatalog } from "@ren/schema/app-catalog"
import { Context, Effect, Layer, Option } from "effect"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AppStore } from "../src/app-store.js"
import { BrainStorage } from "../src/brain-storage.js"

const it = testEffect(Layer.empty)

const empty: AppCatalog.Info = {
  fingerprint: "empty",
  catalog: {
    apps: [],
    mcps: [],
    skills: [],
    unavailable: [],
  },
}

const open = Effect.gen(function* () {
  const directory = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "ren-app-store-"))),
    (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
  )
  const storage = Layer.succeed(BrainStorage.Service, {
    get: async (key) => {
      const file = Bun.file(join(directory, key))
      return (await file.exists()) ? file.text() : undefined
    },
    put: async (key, value) => {
      await Bun.write(join(directory, key), value)
    },
    delete: (key) => rm(join(directory, key), { force: true }),
  })
  const load = Layer.build(Layer.fresh(AppStore.layer).pipe(Layer.provide(storage))).pipe(
    Effect.map((context) => Context.get(context, AppStore.Service)),
  )
  return { directory, load, store: yield* load }
})

it.live("an empty catalog survives restart, but a missing or corrupt body is never acknowledged", () =>
  Effect.gen(function* () {
    const opened = yield* open
    expect(yield* opened.store.current).toEqual(Option.none())
    yield* opened.store.save(empty)
    const restarted = yield* opened.load
    expect(yield* restarted.current).toEqual(Option.some(empty))
    yield* Effect.promise(() => Bun.write(join(opened.directory, "ren:apps"), '{"fingerprint":"empty"}'))
    const corrupt = yield* opened.load
    expect(yield* corrupt.current).toEqual(Option.none())
    yield* Effect.promise(() => rm(join(opened.directory, "ren:apps")))
    const missing = yield* opened.load
    expect(yield* missing.current).toEqual(Option.none())
  }),
)

it.live("a failed catalog write keeps the previous received fingerprint and body", () =>
  Effect.gen(function* () {
    const opened = yield* open
    yield* opened.store.save(empty)
    const path = join(opened.directory, "ren:apps")
    yield* Effect.promise(() => rm(path))
    yield* Effect.promise(() => mkdir(path))
    const result = yield* opened.store.save({ catalog: empty.catalog, fingerprint: "next" }).pipe(Effect.result)
    expect(result._tag).toBe("Failure")
    expect(yield* opened.store.current).toEqual(Option.some(empty))
  }),
)
