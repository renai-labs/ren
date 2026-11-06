import { afterAll, describe, expect, test } from "bun:test"
import { Bundle } from "@ren/schema/bundle"
import { Signature } from "@ren/schema/signature"
import { DateTime, Effect, Schema } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { brainKey, makeApp } from "./lib/app.js"

const directory = await mkdtemp(join(tmpdir(), "ren-bundles-"))

const brain: Bundle.Info = { kind: "brain", version: "0123456789abcdef", sha256: "0".repeat(64) }

const content = crypto.getRandomValues(new Uint8Array(4096))

await Bun.write(join(directory, Bundle.fileOf(brain)), content)
await Bun.write(
  join(directory, "manifest.json"),
  JSON.stringify(Schema.encodeSync(Bundle.Manifest)({ builtAt: DateTime.nowUnsafe(), bundles: [brain] })),
)

const app = makeApp(undefined, { config: { REN_BUNDLES: directory } })

afterAll(async () => {
  await app.dispose()
  await rm(directory, { recursive: true, force: true })
})

const token = (kind: Bundle.Kind, version: string) =>
  Effect.runPromise(
    Signature.sign(brainKey.privateKey, { typ: "bundle", kind, version, exp: Math.floor(Date.now() / 1000) + 60 }),
  )

const download = (path: string, authorization?: string) =>
  app.handler(new Request(`http://localhost:4000${path}`, authorization ? { headers: { authorization } } : {}))

describe("GET /host/bundles/:kind/:version", () => {
  test("gives the archive for a token of that bundle, and 404 without a token, for another bundle, or for one this server lacks", async () => {
    const path = `/host/bundles/brain/${brain.version}`
    const found = await download(path, `Bearer ${await token("brain", brain.version)}`)
    expect(found.status).toBe(200)
    expect(new Uint8Array(await found.arrayBuffer())).toEqual(content)
    expect((await download(path)).status).toBe(404)
    expect((await download(path, `Bearer ${await token("executor", brain.version)}`)).status).toBe(404)
    const missing = `/host/bundles/brain/fedcba9876543210`
    expect((await download(missing, `Bearer ${await token("brain", "fedcba9876543210")}`)).status).toBe(404)
  })
})
