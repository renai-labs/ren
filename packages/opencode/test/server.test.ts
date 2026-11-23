import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { OpenCodeHost } from "@ren/cell/testing"
import { Effect } from "effect"
import { RenServer } from "./lib/ren.js"

process.env["REN_TOKEN"] = ""
process.env["XDG_CONFIG_HOME"] = mkdtempSync(join(tmpdir(), "ren-signed-out-"))

test("signed out, the plugin loads, registers no provider, and OpenCode works as before", () =>
  Effect.gen(function* () {
    const ren = yield* RenServer.make()
    const host = yield* OpenCodeHost.make({
      plugins: [{ package: fileURLToPath(new URL("..", import.meta.url)), options: { url: ren.url } }],
    })
    const models = yield* host.client.model.list({ location: host.location }).pipe(Effect.orDie)
    expect(models.data.filter((each) => each.providerID === "ren")).toEqual([])
    const plugins = yield* host.client.plugin.list({ location: host.location }).pipe(Effect.orDie)
    expect(plugins.data.find((each) => each.id === "ren")?.state).toEqual({ status: "active" })
  }).pipe(Effect.scoped, Effect.runPromise))
