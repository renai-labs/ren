import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type {
  DialogConfirmOptions,
  DialogPromptOptions,
  DialogSelectOptions,
  ToastOptions,
} from "@opencode/plugin/tui/context"
import { OpenCodeHost } from "@ren/cell/testing"
import { Effect, Schema, type Scope } from "effect"
import { RenAuth } from "../src/auth.js"
import { RenCommands } from "../src/commands.js"
import { RenRpc } from "../src/rpc.js"
import { RenServer } from "./lib/ren.js"

process.env["REN_TOKEN"] = ""
const home = mkdtempSync(join(tmpdir(), "ren-login-"))
process.env["XDG_CONFIG_HOME"] = home
const file = join(home, "ren", "credentials.json")

const Stored = Schema.fromJsonString(Schema.Record(Schema.String, RenAuth.Credential))

const stored = () =>
  Effect.promise(async () =>
    (await Bun.file(file).exists()) ? Schema.decodeUnknownSync(Stored)(await Bun.file(file).text()) : {},
  )

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => body.pipe(Effect.scoped, Effect.runPromise)

const follow = (url: string) => fetch(url).then(() => undefined)

const setup = Effect.fnUntraced(function* (
  options: {
    readonly browser?: (url: string) => Promise<string | undefined>
    readonly again?: boolean
    readonly escape?: boolean
  } = {},
) {
  const ren = yield* RenServer.make()
  const host = yield* OpenCodeHost.make({
    plugins: [{ package: fileURLToPath(new URL("..", import.meta.url)), options: { url: ren.url } }],
  })
  const events: Array<string> = []
  const connected = Promise.withResolvers<void>()
  const listening = new AbortController()
  yield* Effect.addFinalizer(() => Effect.sync(() => listening.abort()))
  void (async () => {
    for await (const event of host.promise.event.subscribe({ signal: listening.signal })) {
      if (event.type === "server.connected") connected.resolve()
      else events.push(event.type)
    }
  })().catch(() => undefined)
  yield* Effect.promise(() => connected.promise)
  const toasts: Array<ToastOptions> = []
  const opened: Array<string> = []
  const prompts: Array<DialogPromptOptions> = []
  const confirms: Array<DialogConfirmOptions> = []
  const dialog = { close: () => undefined as void, browsed: Promise.resolve<string | undefined>(undefined) }
  const surface: RenCommands.SignInSurface = {
    client: host.promise,
    location: () => host.location,
    open: (url) => {
      opened.push(url)
      dialog.browsed = (options.browser ?? follow)(url)
    },
    ui: {
      dialog: {
        select: <Value>(_dialog: DialogSelectOptions<Value>) => Promise.resolve(undefined),
        confirm: (confirm) => {
          confirms.push(confirm)
          return Promise.resolve(options.again ?? false)
        },
        prompt: (prompt) => {
          prompts.push(prompt)
          return new Promise((resolve) => {
            dialog.close = () => resolve(undefined)
            if (options.escape) resolve(undefined)
            void dialog.browsed.then((pasted) => pasted && resolve(pasted))
          })
        },
        clear: () => dialog.close(),
      },
      toast: { show: (toast) => toasts.push(toast) },
      router: { navigate: () => undefined, current: () => ({ type: "home" }) },
      model: { current: () => undefined },
    },
  }
  const models = host.client.model.list({ location: host.location }).pipe(
    Effect.orDie,
    Effect.map((listed) => listed.data.filter((each) => each.providerID === "ren").map((each) => String(each.id))),
  )
  const rpc = host.client.rpc(RenRpc.Definition)
  return {
    ren,
    origin: new URL(ren.url).origin,
    host,
    rpc,
    at: { location: host.location },
    surface,
    events,
    toasts,
    opened,
    prompts,
    confirms,
    models,
  }
})

test("/ren:login signs in through the browser, stores the login where the ren CLI reads it, and makes Ren usable without a restart", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      expect(yield* opened.models).toEqual([])

      yield* Effect.promise(() => RenCommands.login(opened.surface))

      expect(opened.opened).toHaveLength(1)
      expect(opened.opened.at(0)).toStartWith(`${opened.origin}/auth/oauth2/authorize?`)
      expect(opened.prompts.at(0)?.description).toContain(opened.opened.at(0))
      expect(opened.toasts).toEqual([{ message: "Signed in to Ren as Ada (ada@example.com).", variant: "success" }])
      expect((yield* stored())[opened.origin]).toMatchObject({
        accessToken: "signed-in",
        refreshToken: "refresh-signed-in",
      })
      expect(yield* opened.models).toEqual(["stub/stub-model"])
      expect((yield* opened.rpc.getSpace({}, opened.at)).id).toBe(opened.ren.state.spaceId)
      expect(opened.events).toContain("rpc.ren.signedIn")

      yield* Effect.promise(() => RenCommands.login(opened.surface))
      expect(opened.confirms).toEqual([
        { title: "Ren", message: `Signed in to ${opened.origin} as Ada (ada@example.com). Sign in again?` },
      ])
      expect(opened.opened).toHaveLength(1)
    }),
  ))

test("when the browser cannot reach the listener, the redirect URL pasted into the dialog finishes the sign-in", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup({
        browser: (url) => fetch(url, { redirect: "manual" }).then((response) => response.headers.get("location") ?? ""),
      })

      yield* Effect.promise(() => RenCommands.login(opened.surface))

      expect(opened.toasts).toEqual([{ message: "Signed in to Ren as Ada (ada@example.com).", variant: "success" }])
      expect((yield* stored())[opened.origin]).toMatchObject({ accessToken: "signed-in" })
    }),
  ))

test("a denied consent tells the user and stores nothing", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      opened.ren.state.oauth.deny = true

      yield* Effect.promise(() => RenCommands.login(opened.surface))

      expect(opened.toasts).toEqual([
        { title: "Sign in to Ren", message: "You denied access to Ren.", variant: "error" },
      ])
      expect((yield* stored())[opened.origin]).toBeUndefined()
    }),
  ))

test("closing the sign-in dialog cancels the sign-in and closes its listener", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup({ browser: () => Promise.resolve(undefined), escape: true })

      yield* Effect.promise(() => RenCommands.login(opened.surface))

      const redirect = new URL(opened.opened.at(0) ?? "").searchParams.get("redirect_uri") ?? ""
      expect(
        yield* Effect.promise(() =>
          fetch(redirect).then(
            () => "open",
            () => "closed",
          ),
        ),
      ).toBe("closed")
      expect(opened.toasts).toEqual([])
      expect((yield* stored())[opened.origin]).toBeUndefined()
    }),
  ))

test("/ren:logout revokes the login, removes it for this server only, and removes the Ren models without a restart", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      yield* Effect.promise(() => RenCommands.login(opened.surface))
      expect(yield* opened.models).toEqual(["stub/stub-model"])
      const others = Object.keys(yield* stored()).filter((origin) => origin !== opened.origin)

      yield* Effect.promise(() => RenCommands.logout(opened.surface))
      yield* Effect.promise(() => RenCommands.logout(opened.surface))

      expect(opened.ren.state.oauth.revoked).toEqual(["refresh-signed-in"])
      expect(Object.keys(yield* stored())).toEqual(others)
      expect(yield* opened.models).toEqual([])
      expect(opened.events).toContain("rpc.ren.signedOut")
      expect(opened.toasts.slice(1)).toEqual([
        { message: `Signed out of ${opened.origin}.`, variant: "success" },
        { message: `Not signed in to ${opened.origin}.`, variant: "info" },
      ])
      expect(yield* opened.rpc.getSpace({}, opened.at).pipe(Effect.flip)).toMatchObject({ type: "signed_out" })
    }),
  ))
