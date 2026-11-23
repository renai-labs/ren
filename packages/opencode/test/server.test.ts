import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { ToastOptions } from "@opencode/plugin/tui/context"
import { OpenCodeHost } from "@ren/cell/testing"
import { Effect } from "effect"
import { RenCommands } from "../src/commands.js"
import { RenRpc } from "../src/rpc.js"
import { RenServer } from "./lib/ren.js"

process.env["REN_TOKEN"] = ""
process.env["XDG_CONFIG_HOME"] = mkdtempSync(join(tmpdir(), "ren-signed-out-"))

const setup = Effect.fnUntraced(function* () {
  const ren = yield* RenServer.make()
  const host = yield* OpenCodeHost.make({
    plugins: [{ package: fileURLToPath(new URL("..", import.meta.url)), options: { url: ren.url } }],
  })
  return { ren, host }
})

test("signed out, the plugin loads, registers no provider, and OpenCode works as before", () =>
  Effect.gen(function* () {
    const opened = yield* setup()
    const models = yield* opened.host.client.model.list({ location: opened.host.location }).pipe(Effect.orDie)
    expect(models.data.filter((each) => each.providerID === "ren")).toEqual([])
    const plugins = yield* opened.host.client.plugin.list({ location: opened.host.location }).pipe(Effect.orDie)
    expect(plugins.data.find((each) => each.id === "ren")?.state).toEqual({ status: "active" })
  }).pipe(Effect.scoped, Effect.runPromise))

test("on an OpenCode release outside the supported range, the plugin loads but registers nothing, not even its RPC", () =>
  Effect.gen(function* () {
    const ren = yield* RenServer.make()
    const host = yield* OpenCodeHost.make(
      { plugins: [{ package: fileURLToPath(new URL("..", import.meta.url)), options: { url: ren.url } }] },
      { version: "2.1.4" },
    )
    yield* host.client.model.list({ location: host.location }).pipe(Effect.orDie)
    const plugins = yield* host.client.plugin.list({ location: host.location }).pipe(Effect.orDie)
    expect(plugins.data.find((each) => each.id === "ren")?.state).toEqual({ status: "active" })
    expect(
      yield* host.client.rpc(RenRpc.Definition).listSpaces({}, { location: host.location }).pipe(Effect.flip),
    ).toMatchObject({ type: "rpc.unavailable" })
  }).pipe(Effect.scoped, Effect.runPromise))

test("signed out, the plugin's RPC answers signed_out and the Ren commands tell the user to run /ren:login", () =>
  Effect.gen(function* () {
    const opened = yield* setup()
    const origin = new URL(opened.ren.url).origin
    const rpc = opened.host.client.rpc(RenRpc.Definition)
    expect(yield* rpc.listSpaces({}, { location: opened.host.location }).pipe(Effect.flip)).toEqual({
      type: "signed_out",
      message: `Not signed in to ${origin}. Run /ren:login.`,
      data: { server: origin },
    })
    const toasts: Array<ToastOptions> = []
    const surface: RenCommands.Surface = {
      client: opened.host.promise,
      location: () => opened.host.location,
      ui: {
        dialog: {
          select: () => Promise.reject(new Error("No dialog opens while signed out.")),
          confirm: () => Promise.reject(new Error("No dialog opens while signed out.")),
        },
        toast: { show: (toast) => toasts.push(toast) },
        router: { navigate: () => undefined, current: () => ({ type: "session", sessionID: "ses_local" }) },
        model: { current: () => undefined },
      },
    }
    yield* Effect.promise(() => RenCommands.space(surface))
    yield* Effect.promise(() => RenCommands.create(surface))
    yield* Effect.promise(() => RenCommands.move(surface))
    const told: ToastOptions = {
      title: "Sign in to Ren",
      message: `Not signed in to ${origin}. Run /ren:login.`,
      variant: "warning",
    }
    expect(toasts).toEqual([told, told, told])
  }).pipe(Effect.scoped, Effect.runPromise))

test("signed out, a Ren session's info answers signed_out, and a local session's info needs no login", () =>
  Effect.gen(function* () {
    const opened = yield* setup()
    const at = { location: opened.host.location }
    const rpc = opened.host.client.rpc(RenRpc.Definition)
    const session = yield* opened.host.client.session.create(at).pipe(Effect.orDie)
    expect(yield* rpc.sessionInfo({ sessionID: session.id }, at)).toMatchObject({ ren: false })
    yield* opened.host.client.session
      .update({
        sessionID: session.id,
        metadata: { ren: { spaceId: opened.ren.state.spaceId, sessionId: session.id } },
      })
      .pipe(Effect.orDie)
    expect(yield* rpc.sessionInfo({ sessionID: session.id }, at).pipe(Effect.flip)).toMatchObject({
      type: "signed_out",
    })
    expect(opened.ren.state.accessed).toEqual([])
  }).pipe(Effect.scoped, Effect.runPromise))
