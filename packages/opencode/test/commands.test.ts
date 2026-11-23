import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import type { Destination, DialogSelectOptions, ToastOptions } from "@opencode/plugin/tui/context"
import { OpenCodeHost } from "@ren/cell/testing"
import { Effect, type Scope } from "effect"
import { Binding } from "../src/binding.js"
import { RenCommands } from "../src/commands.js"
import { RenRpc } from "../src/rpc.js"
import { RenServer } from "./lib/ren.js"

const plugin = fileURLToPath(new URL("..", import.meta.url))

process.env["REN_TOKEN"] = "user-token"

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => body.pipe(Effect.scoped, Effect.runPromise)

const setup = Effect.fnUntraced(function* (
  options: { readonly query?: string; readonly model?: { readonly providerID: string; readonly modelID: string } } = {},
) {
  const ren = yield* RenServer.make()
  const host = yield* OpenCodeHost.make({ plugins: [{ package: plugin, options: { url: ren.url } }] })
  const shown: Array<{ readonly current: unknown; readonly options: ReadonlyArray<readonly [string, unknown]> }> = []
  const toasts: Array<ToastOptions> = []
  const routes: Array<Destination> = []
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
      },
      toast: { show: (toast) => toasts.push(toast) },
      router: { navigate: (destination) => routes.push(destination) },
      model: { current: () => options.model },
    },
  }
  const rpc = host.client.rpc(RenRpc.Definition)
  return { ren, host, rpc, at: { location: host.location }, surface, shown, toasts, routes }
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
