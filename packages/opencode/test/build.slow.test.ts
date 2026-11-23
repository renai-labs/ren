import { expect, setDefaultTimeout, test } from "bun:test"
import { mkdtempSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Model, Provider } from "@opencode/plugin/effect"
import { Host } from "@opencode/plugin/host"
import { ensurePluginRuntime, provides } from "@opencode/plugin/runtime"
import { Plugin, PluginContextProvider, usePlugin } from "@opencode/plugin/tui"
import { ensureRuntimePluginSupport } from "@opentui/solid/runtime-plugin-support/configure"
import { OpenCodeHost } from "@ren/cell/testing"
import { SessionMessage } from "@ren/schema/session/message"
import { Effect } from "effect"
import { OpenCodeBuild } from "../script/build.js"
import { RenRpc } from "../src/rpc.js"
import { RenServer } from "./lib/ren.js"

setDefaultTimeout(60_000)

process.env["REN_TOKEN"] = "user-token"

const directory = join(
  realpathSync(mkdtempSync(join(tmpdir(), "ren-opencode-build-"))),
  "node_modules",
  "@renai-labs",
  "opencode",
)
const built = await OpenCodeBuild.build({ outdir: directory, version: "1.2.3" })
const parts = Host.resolve({ directory })
const workspace = fileURLToPath(new URL("../../..", import.meta.url))

test("the build inlines the Ren packages, only the chat modules the plugin uses, and no copy of what OpenCode provides", async () => {
  const inlined = built.inputs.map((file) => relative(workspace, file))
  expect(inlined.filter((file) => file.startsWith("packages/chat/"))).toEqual([
    "packages/chat/src/chat-access.ts",
    "packages/chat/src/connection.ts",
  ])
  expect(inlined.filter((file) => /node_modules\/(effect|@opencode|@opentui|solid-js|react)\//.test(file))).toEqual([])
  expect(await Bun.file(join(directory, "package.json")).text()).not.toMatch(/workspace:|catalog:/)
  expect(parts).toEqual({
    server: pathToFileURL(join(directory, "server.js")).href,
    tui: pathToFileURL(join(directory, "tui.js")).href,
    rpc: pathToFileURL(join(directory, "rpc.js")).href,
  })
})

test("the built package, alone in a node_modules folder, runs a turn and answers RPC in OpenCode, which provides effect and @opencode/plugin", () =>
  Effect.gen(function* () {
    expect(() => Bun.resolveSync("effect", directory)).toThrow()
    ensurePluginRuntime()
    const ren = yield* RenServer.make()
    ren.state.answer = (prompt) => {
      const step = { sessionID: prompt.sessionID, assistantMessageID: SessionMessage.ID.create() }
      ren.state.delivered.add(prompt.id)
      ren.send(RenServer.frame("session.inbox.delivered", { sessionID: prompt.sessionID, inboxID: prompt.id }))
      ren.send(RenServer.frame("session.text.started", { ...step, ordinal: 0 }))
      ren.send(RenServer.frame("session.text.delta", { ...step, ordinal: 0, delta: "the answer" }))
      ren.send(RenServer.frame("session.text.ended", { ...step, ordinal: 0, text: "the answer" }))
      ren.send(RenServer.frame("session.execution.succeeded", { sessionID: prompt.sessionID }))
    }
    const host = yield* OpenCodeHost.make(
      { plugins: [{ package: directory, options: { url: ren.url } }] },
      { version: "2.2.6" },
    )
    const session = yield* host.client.session
      .create({
        location: host.location,
        model: { providerID: Provider.ID.make("ren"), id: Model.ID.make("stub/stub-model") },
      })
      .pipe(Effect.orDie)
    yield* host.client.session.prompt({ sessionID: session.id, text: "hello" }).pipe(Effect.orDie)
    yield* host.client.experimental.session.wait({ sessionID: session.id }).pipe(Effect.orDie)
    const local = yield* host.client.session.context({ sessionID: session.id }).pipe(Effect.orDie)
    expect(
      local.flatMap((message) =>
        message.type === "assistant"
          ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
          : [],
      ),
    ).toEqual(["the answer"])
    expect(yield* Effect.promise(() => Host.load(String(parts.rpc)))).toMatchObject({ Definition: { id: "ren" } })
    const listed = yield* host.client.rpc(RenRpc.Definition).listSpaces({}, { location: host.location })
    expect(listed.spaces.map((space) => space.slug)).toEqual(["alpha", "beta"])
  }).pipe(Effect.scoped, Effect.runPromise))

test("the TUI part loads with the modules OpenCode's TUI provides to an installed plugin", async () => {
  ensurePluginRuntime()
  ensureRuntimePluginSupport({
    additional: { "@opencode/plugin/tui": { Plugin, PluginContextProvider, usePlugin } },
    preserve: provides,
  })
  expect(await Host.load(String(parts.tui))).toMatchObject({ default: { id: "ren", setup: expect.any(Function) } })
})
