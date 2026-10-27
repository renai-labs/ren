import { afterAll, expect, test } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect, Layer, Option } from "effect"
import { FetchHttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Upgrade } from "../src/upgrade.js"

const root = await mkdtemp(join(tmpdir(), "ren2-update-"))
let checks = 0
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: () => {
    checks += 1
    return new Response("0.0.2\n")
  },
})

afterAll(async () => {
  await server.stop(true)
  await rm(root, { recursive: true, force: true })
})

test("checks for a newer release at most once a day", async () => {
  const options = { host: server.url.origin, cache: join(root, "ren2/update.json"), current: "0.0.1" }
  const seen = await Effect.gen(function* () {
    const first = yield* Upgrade.available(options)
    const again = yield* Upgrade.available(options)
    const before = checks
    yield* TestClock.adjust("25 hours")
    const tomorrow = yield* Upgrade.available(options)
    return { first, again, before, tomorrow, after: checks }
  }).pipe(
    Effect.provide(Layer.mergeAll(TestClock.layer(), FetchHttpClient.layer, BunServices.layer)),
    Effect.runPromise,
  )

  expect(seen).toEqual({
    first: Option.some("0.0.2"),
    again: Option.some("0.0.2"),
    before: 1,
    tomorrow: Option.some("0.0.2"),
    after: 2,
  })
})
