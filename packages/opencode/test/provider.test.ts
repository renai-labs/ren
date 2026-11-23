import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { Model, Provider } from "@opencode/plugin/effect"
import type { Destination, ToastOptions } from "@opencode/plugin/tui/context"
import { OpenCodeHost } from "@ren/cell/testing"
import { Session } from "@ren/schema/session"
import { SessionCapabilities } from "@ren/schema/session/capabilities"
import { SessionMessage } from "@ren/schema/session/message"
import { DateTime, Effect, type Scope } from "effect"
import { Binding } from "../src/binding.js"
import { RenCommands } from "../src/commands.js"
import { RenRpc } from "../src/rpc.js"
import { RenServer } from "./lib/ren.js"

const plugin = fileURLToPath(new URL("..", import.meta.url))
const cloud = Provider.ID.make("ren-cloud")
const gateway = Provider.ID.make("ren")

process.env["REN_TOKEN"] = "user-token"

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => body.pipe(Effect.scoped, Effect.runPromise)

type Ren = Effect.Success<ReturnType<typeof RenServer.make>>

const inference = (ren: Ren, name: string) => ({
  name,
  package: "@ai-sdk/anthropic",
  settings: { baseURL: `${ren.url}/local/v1`, apiKey: "sk-ren-inference" },
  models: {
    "anthropic/claude-opus-5-5": { name: "Claude Opus 5.5", limit: { context: 1_000_000, output: 128_000 } },
    "stub/stub-model": { name: "Gateway Stub", limit: { context: 200_000, output: 64_000 } },
  },
})

const answer = (ren: Ren) => (prompt: RenServer.Prompt) => {
  ren.state.delivered.add(prompt.id)
  const step = { sessionID: prompt.sessionID, assistantMessageID: SessionMessage.ID.create() }
  ren.send(RenServer.frame("session.inbox.delivered", { sessionID: prompt.sessionID, inboxID: prompt.id }))
  ren.send(RenServer.frame("session.text.started", { ...step, ordinal: 0 }))
  ren.send(RenServer.frame("session.text.ended", { ...step, ordinal: 0, text: `re: ${prompt.text}` }))
  ren.send(
    RenServer.frame("session.step.ended", {
      ...step,
      finish: "stop",
      cost: 0,
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    }),
  )
  ren.send(RenServer.frame("session.execution.succeeded", { sessionID: prompt.sessionID }))
}

const setup = Effect.fnUntraced(function* (
  options: {
    readonly providers?: (ren: Ren) => Record<string, unknown>
    readonly plugin?: boolean
    readonly held?: boolean
  } = {},
) {
  const ren = yield* RenServer.make()
  const open = options.held ? ren.hold() : () => undefined
  const host = yield* OpenCodeHost.make({
    ...(options.plugin !== false && {
      plugins: [{ package: plugin, options: { url: ren.url, space: ren.state.spaceId } }],
    }),
    providers: options.providers?.(ren) ?? { ren: inference(ren, "Ren"), "ren-codex": inference(ren, "Ren (Codex)") },
  })
  ren.state.answer = answer(ren)
  const at = { location: host.location }
  const local = (sessionID: string) =>
    host.client.session.get({ sessionID: Binding.LocalID.make(sessionID) }).pipe(Effect.orDie)
  const prompt = (sessionID: string, text: string) =>
    host.client.session
      .prompt({ sessionID: Binding.LocalID.make(sessionID), text })
      .pipe(
        Effect.andThen(host.client.experimental.session.wait({ sessionID: Binding.LocalID.make(sessionID) })),
        Effect.orDie,
      )
  const listed = (providerID: string) =>
    host.client.model.list(at).pipe(
      Effect.orDie,
      Effect.map((models) =>
        models.data
          .filter((each) => each.providerID === providerID)
          .map((each) => ({
            id: String(each.id),
            name: each.name,
            package: each.package,
            limit: each.limit,
            settings: { ...each.settings, baseURL: String(each.settings?.["baseURL"]).replace(ren.url, "<ren>") },
          })),
      ),
    )
  return { ren, host, at, rpc: host.client.rpc(RenRpc.Definition), local, prompt, listed, open }
})

const surface = (
  opened: Effect.Success<ReturnType<typeof setup>>,
  current: { readonly providerID: string; readonly modelID: string },
  route: { readonly sessionID?: string } = {},
) => {
  const toasts: Array<ToastOptions> = []
  const routes: Array<Destination> = []
  const value: RenCommands.Surface = {
    client: opened.host.promise,
    location: () => opened.host.location,
    ui: {
      dialog: { select: () => Promise.resolve(undefined), confirm: () => Promise.resolve(true) },
      toast: { show: (toast) => toasts.push(toast) },
      router: {
        navigate: (destination) => routes.push(destination),
        current: () => (route.sessionID ? { type: "session", sessionID: route.sessionID } : { type: "home" }),
      },
      model: { current: () => current },
    },
  }
  return { value, toasts, routes }
}

test("with a provider ren in the config, the plugin leaves it and its models as they are and lists Ren's models under ren-cloud", () =>
  run(
    Effect.gen(function* () {
      const without = yield* setup({ plugin: false })
      const opened = yield* setup()
      const models = yield* RenServer.models(opened.host, cloud)
      expect(models.map((each) => [String(each.id), each.name, each.package, each.limit])).toEqual([
        ["stub/stub-model", "Stub", "aisdk:@renai-labs/opencode", { context: 0, output: 0 }],
      ])
      const before = yield* without.listed(gateway)
      expect(before.map((each) => each.id).toSorted()).toEqual(["anthropic/claude-opus-5-5", "stub/stub-model"])
      expect(yield* opened.listed(gateway)).toEqual(before)
      expect(before.map((each) => each.settings.baseURL)).toEqual(["<ren>/local/v1", "<ren>/local/v1"])
    }),
  ))

test("with a provider ren in the config, a ren-cloud session runs on Ren and a session on the existing ren provider never reaches Ren", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const mine = yield* opened.host.client.session
        .create({ ...opened.at, model: { providerID: cloud, id: Model.ID.make("stub/stub-model") } })
        .pipe(Effect.orDie)
      yield* opened.prompt(mine.id, "on Ren")
      expect(opened.ren.state.prompts.map((each) => [each.sessionID, each.text])).toEqual([[mine.id, "on Ren"]])
      expect(opened.ren.state.local).toEqual([])
      const theirs = yield* opened.host.client.session
        .create({ ...opened.at, model: { providerID: gateway, id: Model.ID.make("stub/stub-model") } })
        .pipe(Effect.orDie)
      yield* opened.prompt(theirs.id, "on the gateway")
      expect(opened.ren.state.prompts.map((each) => each.text)).toEqual(["on Ren"])
      expect(opened.ren.state.local.length).toBeGreaterThan(0)
      expect(opened.ren.state.created.map((each) => each.id)).toEqual([Session.ID.make(mine.id)])
    }),
  ))

test("with a provider ren in the config, /ren:new, /ren:move and opening a Ren session use ren-cloud, and /ren:new says so", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const fresh = surface(opened, { providerID: "ren-cloud", modelID: "stub/stub-model" })
      yield* Effect.promise(() => RenCommands.create(fresh.value))
      const created = fresh.routes.at(0)
      const createdID = created?.type === "session" ? created.sessionID : ""
      expect(yield* opened.local(createdID)).toMatchObject({
        model: { providerID: "ren-cloud", id: "stub/stub-model" },
      })
      expect(fresh.toasts).toEqual([
        {
          title: "Ren",
          message: "This Ren session runs on ren-cloud/stub/stub-model, because OpenCode already has a provider ren.",
          variant: "info",
        },
      ])

      const gatewayPicked = surface(opened, { providerID: "ren", modelID: "anthropic/claude-opus-5-5" })
      yield* Effect.promise(() => RenCommands.create(gatewayPicked.value))
      const other = gatewayPicked.routes.at(0)
      expect(yield* opened.local(other?.type === "session" ? other.sessionID : "")).toMatchObject({
        model: { providerID: "ren-cloud", id: "stub/stub-model" },
      })

      const moving = yield* opened.host.client.session
        .create({ ...opened.at, model: { providerID: gateway, id: Model.ID.make("stub/stub-model") } })
        .pipe(Effect.orDie)
      const move = surface(opened, { providerID: "ren-cloud", modelID: "stub/stub-model" }, { sessionID: moving.id })
      yield* Effect.promise(() => RenCommands.move(move.value))
      expect(opened.ren.state.imported.map((each) => [each.id, each.model])).toEqual([
        [Session.ID.make(moving.id), { providerID: "stub", id: "stub-model" }],
      ])
      expect(yield* opened.local(moving.id)).toMatchObject({
        model: { providerID: "ren-cloud", id: "stub/stub-model" },
        metadata: { ren: { sessionId: moving.id } },
      })

      const elsewhere: Session.Info = {
        id: Session.ID.create(),
        spaceId: opened.ren.state.spaceId,
        createdBy: opened.ren.state.bea.id,
        agentId: null,
        origin: "chat",
        harness: "opencode",
        title: "Elsewhere",
        status: "idle",
        capabilities: SessionCapabilities.of("opencode"),
        createdAt: DateTime.nowUnsafe(),
        updatedAt: DateTime.nowUnsafe(),
        archivedAt: null,
        filesResetAt: null,
      }
      opened.ren.state.sessions.push(elsewhere)
      const found = yield* opened.rpc.openSession({ sessionId: elsewhere.id }, opened.at)
      expect(found.import?.info.model).toEqual({ providerID: "ren-cloud", id: "stub/stub-model" })
    }),
  ))

test("a Ren session started on ren/<model> before a provider ren appeared moves to ren-cloud at its next prompt and runs on Ren", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const id = Session.ID.create()
      yield* opened.host.client.session
        .create({
          ...opened.at,
          id: Binding.LocalID.make(id),
          model: { providerID: gateway, id: Model.ID.make("stub/stub-model"), variant: Model.VariantID.make("high") },
          metadata: { ren: { spaceId: opened.ren.state.spaceId, sessionId: id } },
        })
        .pipe(Effect.orDie)
      opened.ren.state.remoteModels.set(id, { providerID: "stub", id: "stub-model", variant: "high" })
      yield* opened.prompt(id, "still on Ren")
      expect(opened.ren.state.prompts.map((each) => each.text)).toEqual(["still on Ren"])
      expect(opened.ren.state.local).toEqual([])
      expect(yield* opened.local(id)).toMatchObject({
        model: { providerID: "ren-cloud", id: "stub/stub-model", variant: "high" },
      })
      yield* opened.host.client.session
        .switchModel({
          sessionID: Binding.LocalID.make(id),
          model: { providerID: gateway, id: Model.ID.make("anthropic/claude-opus-5-5") },
        })
        .pipe(Effect.orDie)
      yield* opened.prompt(id, "back on Ren")
      expect(opened.ren.state.prompts.map((each) => each.text)).toEqual(["still on Ren", "back on Ren"])
      expect(opened.ren.state.local).toEqual([])
      expect(yield* opened.local(id)).toMatchObject({ model: { providerID: "ren-cloud", id: "stub/stub-model" } })
    }),
  ))

test("a Ren session on ren-cloud moves to ren at its next prompt once no other provider ren exists", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup({ providers: () => ({}) })
      const id = Session.ID.create()
      yield* opened.host.client.session
        .create({
          ...opened.at,
          id: Binding.LocalID.make(id),
          model: { providerID: cloud, id: Model.ID.make("stub/stub-model") },
          metadata: { ren: { spaceId: opened.ren.state.spaceId, sessionId: id } },
        })
        .pipe(Effect.orDie)
      yield* opened.prompt(id, "hello")
      expect(opened.ren.state.prompts.map((each) => each.text)).toEqual(["hello"])
      expect(yield* opened.local(id)).toMatchObject({ model: { providerID: "ren", id: "stub/stub-model" } })
      expect(yield* opened.listed(cloud)).toEqual([])
    }),
  ))

test("with providers ren and ren-cloud in the config, the plugin registers no models, changes neither, and its RPC says why", () =>
  run(
    Effect.gen(function* () {
      const providers = (ren: Ren) => ({ ren: inference(ren, "Ren"), "ren-cloud": inference(ren, "Mine") })
      const without = yield* setup({ plugin: false, providers })
      const opened = yield* setup({ providers })
      expect((yield* opened.rpc.listSpaces({}, opened.at)).spaces.map((each) => each.name)).toEqual(["Alpha", "Beta"])
      expect(yield* opened.rpc.createSession({}, opened.at).pipe(Effect.flip)).toMatchObject({
        type: "unavailable",
        message:
          "OpenCode already has providers ren and ren-cloud that are not Ren’s, so Ren’s models are not registered. Rename one of them in your OpenCode config.",
      })
      expect(yield* opened.listed(gateway)).toEqual(yield* without.listed(gateway))
      expect(yield* opened.listed(cloud)).toEqual(yield* without.listed(cloud))
    }),
  ))

test("OpenCode finishes loading the plugin and answers while Ren does not, and Ren's models appear once Ren answers", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup({ providers: () => ({}), held: true })
      expect(yield* opened.listed(gateway)).toEqual([])
      const plugins = yield* opened.host.client.plugin.list(opened.at).pipe(Effect.orDie)
      expect(plugins.data.find((each) => each.id === "ren")?.state).toEqual({ status: "active" })
      const session = yield* opened.host.client.session
        .create({ ...opened.at, model: { providerID: gateway, id: Model.ID.make("stub/stub-model") } })
        .pipe(Effect.orDie)
      opened.open()
      yield* opened.prompt(session.id, "after the wait")
      expect(opened.ren.state.prompts.map((each) => each.text)).toEqual(["after the wait"])
      expect((yield* opened.listed(gateway)).map((each) => each.id)).toEqual(["stub/stub-model"])
    }),
  ))
