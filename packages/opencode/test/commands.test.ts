import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { Model, Provider } from "@opencode/plugin/effect"
import type {
  Destination,
  DialogConfirmOptions,
  DialogSelectOptions,
  Route,
  ToastOptions,
} from "@opencode/plugin/tui/context"
import { OpenCodeHost, Shared } from "@ren/cell/testing"
import { Effect, Schema, type Scope } from "effect"
import { Binding } from "../src/binding.js"
import { RenCommands } from "../src/commands.js"
import { RenRpc } from "../src/rpc.js"
import { RenServer } from "./lib/ren.js"

const plugin = fileURLToPath(new URL("..", import.meta.url))

process.env["REN_TOKEN"] = "user-token"

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => body.pipe(Effect.scoped, Effect.runPromise)

const setup = Effect.fnUntraced(function* (
  options: {
    readonly query?: string
    readonly model?: { readonly providerID: string; readonly modelID: string }
    readonly confirm?: boolean
    readonly isLocal?: boolean
  } = {},
) {
  const ren = yield* RenServer.make()
  const host = yield* OpenCodeHost.make({
    ...(options.isLocal &&
      Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(
        Shared.vars(Shared.stub().url).OPENCODE_CONFIG,
      )),
    plugins: [{ package: plugin, options: { url: ren.url } }],
  })
  const shown: Array<{ readonly current: unknown; readonly options: ReadonlyArray<readonly [string, unknown]> }> = []
  const asked: Array<DialogConfirmOptions> = []
  const toasts: Array<ToastOptions> = []
  const routes: Array<Destination> = []
  const route: { current: Route } = { current: { type: "home" } }
  const surface: RenCommands.Surface = {
    client: host.promise,
    location: () => host.location,
    ui: {
      dialog: {
        select: <Value>(dialog: DialogSelectOptions<Value>) => {
          shown.push({
            current: dialog.current,
            options: dialog.options.map((option) => [option.title, option.description] as const),
          })
          return Promise.resolve(dialog.search?.(options.query ?? "", dialog.options).at(0)?.value)
        },
        confirm: (dialog) => {
          asked.push(dialog)
          return Promise.resolve(options.confirm ?? true)
        },
      },
      toast: { show: (toast) => toasts.push(toast) },
      router: { navigate: (destination) => routes.push(destination), current: () => route.current },
      model: { current: () => options.model },
    },
  }
  const rpc = host.client.rpc(RenRpc.Definition)
  const local = Effect.fnUntraced(function* (replies: ReadonlyArray<string>) {
    const session = yield* host.client.session
      .create({
        location: host.location,
        title: "Fix the login loop",
        model: { providerID: Provider.ID.make("stub"), id: Model.ID.make("stub-model") },
      })
      .pipe(Effect.orDie)
    yield* Effect.forEach(
      replies,
      (reply) =>
        host.client.session
          .prompt({ sessionID: session.id, text: Shared.stub().script({ reply }).marker })
          .pipe(Effect.andThen(host.client.experimental.session.wait({ sessionID: session.id })), Effect.orDie),
      { discard: true },
    )
    route.current = { type: "session", sessionID: session.id }
    return session.id
  })
  return { ren, host, rpc, at: { location: host.location }, surface, shown, asked, toasts, routes, local }
})

test("/ren:space offers the joined spaces with the selected one current, searches them by name, and selects the chosen one", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup({ query: "BET" })
      yield* Effect.promise(() => RenCommands.space(opened.surface))
      const dialog = opened.shown.at(0)
      expect(dialog?.current).toBe(opened.ren.state.spaceId)
      expect(dialog?.options).toEqual([
        ["Alpha", "alpha"],
        ["Beta", "beta"],
      ])
      expect((yield* opened.rpc.getSpace({}, opened.at)).name).toBe("Beta")
      expect(opened.toasts).toEqual([{ message: "Ren space: Beta", variant: "success" }])
    }),
  ))

test("/ren:new opens a new session in the selected space with the prompt's Ren model", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup({ model: { providerID: "ren", modelID: "stub/stub-model" } })
      yield* Effect.promise(() => RenCommands.create(opened.surface))
      const route = opened.routes.at(0)
      expect(route?.type).toBe("session")
      const sessionID = route?.type === "session" ? route.sessionID : ""
      expect(
        yield* opened.host.client.session.get({ sessionID: Binding.LocalID.make(sessionID) }).pipe(Effect.orDie),
      ).toMatchObject({
        metadata: { ren: { spaceId: opened.ren.state.spaceId } },
        model: { providerID: "ren", id: "stub/stub-model" },
      })
      expect(opened.toasts).toEqual([])
    }),
  ))

test("with REN_TOKEN, /ren:login and /ren:logout say that the token comes from the environment and change nothing", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const asked: Array<string> = []
      const surface: RenCommands.SignInSurface = {
        ...opened.surface,
        open: (url) => asked.push(url),
        ui: {
          ...opened.surface.ui,
          dialog: {
            ...opened.surface.ui.dialog,
            prompt: (prompt) => Promise.resolve(void asked.push(prompt.title)),
            confirm: (confirm) => Promise.resolve(Boolean(asked.push(confirm.title))),
            clear: () => undefined,
          },
        },
      }
      yield* Effect.promise(() => RenCommands.login(surface))
      yield* Effect.promise(() => RenCommands.logout(surface))
      const told: ToastOptions = {
        title: "Ren",
        message: "Ren uses REN_TOKEN from the environment. Unset it to sign in or out from OpenCode.",
        variant: "warning",
      }
      expect(opened.toasts).toEqual([told, told])
      expect(asked).toEqual([])
      expect(opened.ren.state.oauth.revoked).toEqual([])
      expect(yield* opened.rpc.account({}, opened.at)).toEqual({
        server: new URL(opened.ren.url).origin,
        environment: true,
        user: { name: "Ada", email: "ada@example.com" },
      })
    }),
  ))

test("/ren:move asks to move the open session to the selected space, sends its export with the same ID and the prompt's Ren model, and the local session becomes that Ren session", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup({ model: { providerID: "ren", modelID: "stub/stub-model" }, isLocal: true })
      const sessionID = yield* opened.local(["Look at auth.ts.", "It loops on refresh."])
      const before = yield* opened.host.client.session.context({ sessionID }).pipe(Effect.orDie)
      yield* Effect.promise(() => RenCommands.move(opened.surface))
      expect(opened.asked.map((dialog) => [dialog.title, dialog.message.includes("Ren space Alpha")])).toEqual([
        ["Move to Ren", true],
      ])
      const imported = opened.ren.state.imported.at(0)
      expect(imported).toMatchObject({
        id: sessionID,
        spaceId: opened.ren.state.spaceId,
        harness: "opencode",
        model: { providerID: "stub", id: "stub-model" },
        transcript: { info: { id: sessionID, title: "Fix the login loop" } },
      })
      expect(
        Schema.decodeUnknownSync(Schema.Struct({ messages: Schema.Array(Schema.Struct({ id: Schema.String })) }))(
          imported?.transcript,
        ).messages.map((message) => message.id),
      ).toEqual(before.map((message) => String(message.id)))
      expect(
        yield* opened.host.client.session.get({ sessionID: Binding.LocalID.make(sessionID) }).pipe(Effect.orDie),
      ).toMatchObject({
        metadata: { ren: { spaceId: opened.ren.state.spaceId, sessionId: sessionID } },
        model: { providerID: "ren", id: "stub/stub-model" },
      })
      expect(opened.toasts.map((toast) => [toast.message, toast.variant])).toEqual([
        ["Moving the session to Alpha…", "info"],
        ["Moved to Ren space Alpha", "success"],
      ])
    }),
  ))

test("/ren:move moves nothing when the user declines", () =>
  run(
    Effect.gen(function* () {
      const declined = yield* setup({ confirm: false, isLocal: true })
      yield* declined.local(["Done."])
      yield* Effect.promise(() => RenCommands.move(declined.surface))
      expect([declined.ren.state.imported, declined.toasts]).toEqual([[], []])
    }),
  ))

test("/ren:move tells why when Ren refuses, and leaves the session local so /ren:move can run again", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup({ isLocal: true })
      const sessionID = yield* opened.local(["Done."])
      opened.ren.state.refuseImport = () =>
        Response.json({ _tag: "NotFoundError", message: "Space not found." }, { status: 404 })
      yield* Effect.promise(() => RenCommands.move(opened.surface))
      const local = opened.host.client.session.get({ sessionID: Binding.LocalID.make(sessionID) }).pipe(Effect.orDie)
      expect(yield* local).toMatchObject({ model: { providerID: "stub" } })
      expect((yield* local).metadata?.["ren"]).toBeUndefined()
      expect(opened.toasts.at(-1)).toEqual({
        title: "Ren",
        message: "Ren did not move the session: Space not found.",
        variant: "error",
      })
      opened.ren.state.refuseImport = () => undefined
      yield* Effect.promise(() => RenCommands.move(opened.surface))
      expect(yield* local).toMatchObject({
        model: { providerID: "ren", id: "stub/stub-model" },
        metadata: { ren: { sessionId: sessionID } },
      })
    }),
  ))
