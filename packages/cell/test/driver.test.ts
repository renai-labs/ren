import { describe, expect, setDefaultTimeout } from "bun:test"
import { AbsolutePath, Model, OpenCode, Provider, Session } from "@opencode/client/effect"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { Plugin, Reference } from "@opencode/plugin/effect"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { EnvironmentAccess } from "@ren/brain/environment/access"
import { EnvironmentConnections } from "@ren/brain/environment/connections"
import { TestAccess } from "@ren/brain/testing"
import { TestEnvironment, testEffect } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
// ast-grep-ignore: no-import-alias -- OpenCode's Session is imported too, and both are values
import { Session as RenSession } from "@ren/schema/session"
import { Context, Deferred, Effect, Layer, ManagedRuntime, Option, Predicate, type Scope, Stream } from "effect"
import { FetchHttpClient, HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, realpath, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OpenCodeHarness } from "../src/harness/opencode/harness.js"
import { OpenCodeServer } from "../src/harness/opencode/server.js"
import { RenWorkspaceDriver } from "../src/harness/opencode/workspace-driver.js"
import { Shared } from "./lib/shared.js"
import type { StubModel } from "./lib/stub-model.js"

setDefaultTimeout(60_000)

const it = testEffect(Layer.empty)

const environmentId = Environment.ID.create()
const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-driver-environment-")))
const onEnvironment = testEffect(TestEnvironment.layer({ environmentId, workspace }))

const stub = Shared.stub()

const boot = Effect.fnUntraced(function* (setup: (context: Plugin.Context) => Effect.Effect<void, never, Scope.Scope>) {
  const directory = yield* Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), "ren-driver-"))))
  yield* Effect.promise(() => writeFile(join(directory, "notes.txt"), "the notes\n"))
  const runtime = yield* Effect.acquireRelease(
    Effect.sync(() =>
      ManagedRuntime.make(
        createEmbeddedRoutes({
          database: { path: ":memory:" },
          config: { project: false, content: Shared.vars(stub.url).OPENCODE_CONFIG },
          models: { fetch: false },
          fs: { filewatcher: false, fff: false },
        }).pipe(Layer.provide(HttpServer.layerServices)),
      ),
    ),
    (opened) => opened.disposeEffect,
  )
  const services = yield* runtime.contextEffect
  const loaded = yield* Deferred.make<void>()
  yield* Context.get(services, SdkPlugins.Service).register(
    Plugin.define({
      id: "driver-test",
      effect: (context) => setup(context).pipe(Effect.andThen(Deferred.succeed(loaded, undefined))),
    }),
  )
  const handler = HttpEffect.toWebHandler(Context.get(services, HttpRouter.HttpRouter).asHttpEffect())
  yield* Effect.promise(() => handler(new Request("http://opencode/api/agent")))
  yield* Deferred.await(loaded)
  const client = yield* OpenCode.make({ baseUrl: "http://opencode" }).pipe(
    Effect.provide(Layer.fresh(FetchHttpClient.layer)),
    Effect.provideService(
      FetchHttpClient.Fetch,
      Object.assign(
        (input: string | URL | Request, init?: RequestInit) =>
          handler(new Request(input instanceof Request ? input.url : String(input), init)),
        { preconnect: fetch.preconnect },
      ),
    ),
  )
  const session = (input: Parameters<typeof client.session.create>[0] = {}) =>
    client.session.create({ ...input, location: { directory: AbsolutePath.make(directory) } }).pipe(Effect.orDie)
  const turn = (sessionID: Session.ID, script: StubModel.Script) =>
    client.session
      .prompt({ sessionID, text: `${script.marker} go` })
      .pipe(Effect.andThen(client.session.wait({ sessionID })), Effect.orDie)
  return { client, directory, session, turn }
})

const subagent = (agent: string, child: StubModel.Script) => ({
  name: "subagent",
  input: { agent, description: "help with notes", prompt: `${child.marker} help` },
})

const tool = (call: StubModel.Call | undefined, name: string) =>
  call?.body.tools?.find((each) => each.function.name === name)?.function

const description = (call: StubModel.Call | undefined, name: string) => tool(call, name)?.description ?? ""

const parameters = (call: StubModel.Call | undefined, name: string) => tool(call, name)?.parameters

const toolResults = (calls: ReadonlyArray<StubModel.Call>) =>
  (calls.at(-1)?.body.messages ?? [])
    .filter((message) => message.role === "tool")
    .map((message) => JSON.stringify(message.content))

describe("OpenCode facts the Ren driver relies on", () => {
  it.live("a permission hook that returns deny blocks the call, and the model gets the message", () =>
    Effect.gen(function* () {
      const opened = yield* boot((context) =>
        context.permission
          .hook("evaluate", (event) =>
            Effect.sync(() => {
              if (event.action !== "read") return
              event.effect = "deny"
              event.message = "Ren does not allow this read."
            }),
          )
          .pipe(Effect.asVoid),
      )
      const script = stub.script({ tools: [{ name: "read", input: { path: join(opened.directory, "notes.txt") } }] })
      const session = yield* opened.session()
      yield* opened.turn(session.id, script)
      expect(script.calls).toHaveLength(2)
      expect(toolResults(script.calls).join("\n")).toContain("Ren does not allow this read.")
      expect(toolResults(script.calls).join("\n")).not.toContain("the notes")
    }),
  )

  it.live("a permission hook that returns ask wins over a saved always allow", () =>
    Effect.gen(function* () {
      const seen: Array<string> = []
      const state = { override: false }
      const opened = yield* boot((context) =>
        context.permission
          .hook("evaluate", (event) =>
            Effect.sync(() => {
              if (event.action !== "read") return
              seen.push(event.effect)
              if (state.override) event.effect = "ask"
            }),
          )
          .pipe(Effect.asVoid),
      )
      const session = yield* opened.session({ permissions: [{ action: "read", resource: "*", effect: "ask" }] })
      const asked: Array<string> = []
      const connected = yield* Deferred.make<void>()
      yield* opened.client.event.subscribe().pipe(
        Stream.tap((event) =>
          event.type === "server.connected" ? Deferred.succeed(connected, undefined) : Effect.void,
        ),
        Stream.filter((event) => event.type === "permission.asked"),
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            asked.push(event.data.action)
            yield* opened.client.permission
              .reply({
                sessionID: event.data.sessionID,
                requestID: event.data.id,
                decision: asked.length === 1 ? "always" : "reject",
              })
              .pipe(Effect.orDie)
          }),
        ),
        Effect.forkScoped,
      )
      yield* Deferred.await(connected)
      const read = { name: "read", input: { path: join(opened.directory, "notes.txt") } }
      const first = stub.script({ tools: [read] })
      yield* opened.turn(session.id, first)
      expect(toolResults(first.calls).join("\n")).toContain("the notes")
      state.override = true
      const second = stub.script({ tools: [read] })
      yield* opened.turn(session.id, second)
      expect(seen).toEqual(["ask", "allow"])
      expect(asked).toEqual(["read", "read"])
    }),
  )

  it.live("a tool that the context hook removes is not shown to the model, and a call to it is refused", () =>
    Effect.gen(function* () {
      const opened = yield* boot((context) =>
        context.session
          .hook("context", (event) =>
            Effect.sync(() => {
              delete event.tools.read
            }),
          )
          .pipe(Effect.asVoid),
      )
      const script = stub.script({ tools: [{ name: "read", input: { path: join(opened.directory, "notes.txt") } }] })
      const session = yield* opened.session()
      yield* opened.turn(session.id, script)
      expect(script.calls[0]?.tools).not.toContain("read")
      expect(script.calls[0]?.tools).toContain("glob")
      expect(toolResults(script.calls)).toHaveLength(1)
      expect(toolResults(script.calls).join("\n")).not.toContain("the notes")
    }),
  )

  it.live("the context hook runs for a child session with the subagent's agent id", () =>
    Effect.gen(function* () {
      const contexts: Array<{ readonly sessionID: string; readonly agent: string }> = []
      const opened = yield* boot((context) =>
        Effect.all([
          context.agent.transform((editor) =>
            editor.update("helper", (agent) => {
              agent.mode = "subagent"
              agent.description = "Helps with notes"
            }),
          ),
          context.session.hook("context", (event) =>
            Effect.sync(() => {
              contexts.push({ sessionID: event.sessionID, agent: event.agent })
            }),
          ),
        ]).pipe(Effect.asVoid),
      )
      const child = stub.script({ reply: "child done" })
      const parent = stub.script({ tools: [subagent("helper", child)] })
      const session = yield* opened.session()
      yield* opened.turn(session.id, parent)
      expect(child.calls).toHaveLength(1)
      expect(contexts.filter((each) => each.sessionID === session.id).map((each) => each.agent)).toContain("build")
      expect(contexts.filter((each) => each.sessionID !== session.id).map((each) => each.agent)).toEqual(["helper"])
    }),
  )

  it.live("agent.reload during a turn changes the subagent list for the next tool call", () =>
    Effect.gen(function* () {
      const state = { late: false }
      const opened = yield* boot((context) =>
        Effect.all([
          context.agent.transform((editor) => {
            for (const id of ["helper", ...(state.late ? ["late"] : [])])
              editor.update(id, (agent) => {
                agent.mode = "subagent"
                agent.description = `The ${id} subagent`
              })
          }),
          context.tool.hook("execute.before", (event) =>
            event.tool !== "read"
              ? Effect.void
              : Effect.sync(() => {
                  state.late = true
                }).pipe(Effect.andThen(context.agent.reload())),
          ),
        ]).pipe(Effect.asVoid),
      )
      const child = stub.script({ reply: "late child done" })
      const parent = stub.script({
        tools: [{ name: "read", input: { path: join(opened.directory, "notes.txt") } }, subagent("late", child)],
      })
      const session = yield* opened.session()
      yield* opened.turn(session.id, parent)
      expect(description(parent.calls[0], "subagent")).not.toContain("- late:")
      expect(description(parent.calls[1], "subagent")).toContain("- late: The late subagent")
      expect(child.calls).toHaveLength(1)
      expect(toolResults(parent.calls).at(-1)).toContain("late child done")
    }),
  )

  it.live("switchModel on a running child applies at its next step", () =>
    Effect.gen(function* () {
      const opened = yield* boot((context) =>
        Effect.all([
          context.agent.transform((editor) =>
            editor.update("helper", (agent) => {
              agent.mode = "subagent"
              agent.description = "Helps with notes"
            }),
          ),
          context.tool.hook("execute.before", (event) =>
            event.tool !== "read"
              ? Effect.void
              : context.session
                  .switchModel({
                    sessionID: event.sessionID,
                    model: { providerID: Provider.ID.make("stub"), id: Model.ID.make("stub-other") },
                  })
                  .pipe(Effect.orDie, Effect.asVoid),
          ),
        ]).pipe(Effect.asVoid),
      )
      const child = stub.script({ tools: [{ name: "read", input: { path: join(opened.directory, "notes.txt") } }] })
      const parent = stub.script({ tools: [subagent("helper", child)] })
      const session = yield* opened.session()
      yield* opened.turn(session.id, parent)
      expect(child.calls.map((call) => call.body.model)).toEqual(["stub-model", "stub-other"])
      expect(parent.calls.map((call) => call.body.model)).toEqual(["stub-model", "stub-model"])
    }),
  )

  it.live("a context hook and an execute hook can take the model parameter away from the subagent tool", () =>
    Effect.gen(function* () {
      const opened = yield* boot((context) =>
        Effect.all([
          context.agent.transform((editor) =>
            editor.update("helper", (agent) => {
              agent.mode = "subagent"
              agent.description = "Helps with notes"
            }),
          ),
          context.session.hook("context", (event) =>
            Effect.sync(() => {
              const tool = event.tools.subagent
              const input = tool?.input
              if (!tool || !Predicate.isObject(input) || !Predicate.isObject(input.properties)) return
              tool.input = {
                ...input,
                properties: Object.fromEntries(
                  Object.entries(input.properties).filter((entry) => entry[0] !== "model"),
                ),
              }
            }),
          ),
          context.tool.hook("execute.before", (event) =>
            Effect.sync(() => {
              if (event.tool !== "subagent" || !Predicate.isObject(event.input)) return
              event.input = Object.fromEntries(Object.entries(event.input).filter((entry) => entry[0] !== "model"))
            }),
          ),
        ]).pipe(Effect.asVoid),
      )
      const child = stub.script({ reply: "child done" })
      const parent = stub.script({
        tools: [{ name: "subagent", input: { ...subagent("helper", child).input, model: "stub/stub-other" } }],
      })
      const session = yield* opened.session()
      yield* opened.turn(session.id, parent)
      expect(JSON.stringify(parameters(parent.calls[0], "subagent"))).not.toContain('"model"')
      expect(child.calls.map((call) => call.body.model)).toEqual(["stub-model"])
    }),
  )

  it.live("reference.transform with a local source, then reload, shows the reference at the next step of a turn", () =>
    Effect.gen(function* () {
      const docs = yield* Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), "ren-docs-"))))
      const state = { added: false }
      const opened = yield* boot((context) =>
        Effect.all([
          context.reference.transform((editor) => {
            const source: Reference.LocalSource = {
              type: "local",
              path: AbsolutePath.make(docs),
              description: "Use for product docs",
            }
            if (state.added) editor.add("docs", source)
          }),
          context.tool.hook("execute.before", (event) =>
            event.tool !== "read"
              ? Effect.void
              : Effect.sync(() => {
                  state.added = true
                }).pipe(Effect.andThen(context.reference.reload())),
          ),
        ]).pipe(Effect.asVoid),
      )
      const script = stub.script({ tools: [{ name: "read", input: { path: join(opened.directory, "notes.txt") } }] })
      const session = yield* opened.session()
      yield* opened.turn(session.id, script)
      const calls = stub.calls.filter(
        (call) => call.kind === "turn" && JSON.stringify(call.body).includes(script.marker),
      )
      expect(calls).toHaveLength(2)
      expect(JSON.stringify(calls[0]?.body)).not.toContain(docs)
      expect(JSON.stringify(calls[1]?.body)).toContain(docs)
      expect(JSON.stringify(calls[1]?.body)).toContain("Use for product docs")
    }),
  )

  onEnvironment.live(
    "a read on a path outside the session folder goes to the environment through the workspace driver",
    () =>
      Effect.gen(function* () {
        const reference = yield* Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), "ren-reference-"))))
        yield* Effect.promise(() => writeFile(join(reference, "guide.md"), "the guide\n"))
        const access = yield* Layer.build(TestAccess.memory(new Map()))
        const memory = Context.get(access, TestAccess.Memory)
        const connections = Context.get(
          yield* Layer.build(
            EnvironmentConnections.layer.pipe(
              Layer.provide(Layer.succeed(EnvironmentAccess.Service, Context.get(access, EnvironmentAccess.Service))),
              Layer.provide(FetchHttpClient.layer),
            ),
          ),
          EnvironmentConnections.Service,
        )
        const connects = { count: 0 }
        const counted = EnvironmentConnections.Service.of({
          ...connections,
          connect: (sessionId) =>
            Effect.sync(() => {
              connects.count += 1
            }).pipe(Effect.andThen(connections.connect(sessionId))),
        })
        const endpoints = Shared.access(undefined, stub.url).endpoints
        const server = yield* OpenCodeServer.make(
          createEmbeddedRoutes(
            {
              database: { path: ":memory:" },
              config: { project: false, content: Shared.vars(stub.url).OPENCODE_CONFIG },
              models: { fetch: false },
              fs: { filewatcher: false, fff: false },
            },
            RenWorkspaceDriver.replacements(counted),
          ).pipe(Layer.provide(HttpServer.layerServices)),
          endpoints,
          () => Effect.succeedNone,
          Option.some(counted),
        )
        const harness = yield* OpenCodeHarness.make(server, endpoints)
        const sessionId = RenSession.ID.create()
        const directory = join(workspace, sessionId)
        yield* memory.set(
          sessionId,
          yield* TestEnvironment.access({
            url: yield* TestEnvironment.url,
            environmentId,
            brain: Brain.ofSession(sessionId),
            directory,
          }),
        )
        yield* harness.start({ sessionId, harness: "opencode", interactive: true, directory })
        const script = stub.script({ tools: [{ name: "read", input: { path: join(reference, "guide.md") } }] })
        const before = connects.count
        yield* harness.send({
          sessionId,
          messageId: RenSession.MessageID.create(),
          prompt: { text: `${script.marker} read the guide` },
          delivery: "steer",
          sender: { userId: "user_1" },
        })
        yield* Effect.promise(() => script.called(2))
        expect(toolResults(script.calls).join("\n")).toContain("the guide")
        expect(connects.count).toBeGreaterThan(before)
      }),
  )

  it.live(
    "a read outside the session directory asks external_directory for the folder, and an edit gives the absolute path",
    () =>
      Effect.gen(function* () {
        const outside = yield* Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), "ren-outside-"))))
        yield* Effect.promise(() => writeFile(join(outside, "other.txt"), "other notes\n"))
        const asked: Array<{ readonly action: string; readonly resources: ReadonlyArray<string> }> = []
        const opened = yield* boot((context) =>
          context.permission
            .hook("evaluate", (event) =>
              Effect.sync(() => {
                asked.push({ action: event.action, resources: event.resources })
                event.effect = "allow"
              }),
            )
            .pipe(Effect.asVoid),
        )
        const file = join(outside, "other.txt")
        const script = stub.script({
          tools: [
            { name: "read", input: { path: file } },
            { name: "edit", input: { path: file, oldString: "other", newString: "changed" } },
          ],
        })
        const session = yield* opened.session()
        yield* opened.turn(session.id, script)
        expect(asked).toContainEqual({ action: "external_directory", resources: [`${outside}/*`] })
        expect(asked).toContainEqual({ action: "edit", resources: [file] })
      }),
  )
})
