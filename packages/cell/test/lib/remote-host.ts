export * as RemoteHost from "./remote-host.js"

import { TestAccess } from "@ren/brain/testing"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { EnvironmentAccess } from "@ren/brain/environment/access"
import { EnvironmentConnections } from "@ren/brain/environment/connections"
import { TestEnvironment, Processes } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { Context, Duration, Effect, Layer, Option, Ref, Schedule, Schema } from "effect"
import { FetchHttpClient, HttpServer } from "effect/http"
import { mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Env } from "../../src/env.js"
import type { Harness } from "../../src/harness/harness.js"
import { OpenCodeHarness } from "../../src/harness/opencode/harness.js"
import type { RenPlugin } from "../../src/harness/opencode/plugin.js"
import { OpenCodeServer } from "../../src/harness/opencode/server.js"
import { RenWorkspaceDriver } from "../../src/harness/opencode/workspace-driver.js"
import { Shared } from "./shared.js"
import type { StubModel } from "./stub-model.js"

const environmentId = Environment.ID.create()
export const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-remote-")))
const local = await realpath(await mkdtemp(join(tmpdir(), "ren-remote-local-")))
const stub = Shared.stub()
export const gptModel = { id: "gpt-5-stub", name: "Stub GPT", limit: { context: 100_000, output: 4000 } }
// oxlint-disable-next-line ren/no-comments -- OpenCode offers `patch` instead of `edit` and `write` to GPT models only.
const vars = Schema.decodeUnknownSync(Env.Vars)(Shared.vars(stub.url, { [gptModel.id]: gptModel }))
// oxlint-disable-next-line oxc/no-map-spread -- one endpoint gets one more model
export const endpoints = Shared.access(undefined, stub.url).endpoints.map((endpoint) =>
  endpoint.id === "stub" ? { ...endpoint, models: [...endpoint.models, gptModel] } : endpoint,
)

export const served = TestEnvironment.layer({ environmentId, workspace })

export const folder = (sessionId: Session.ID) => join(workspace, sessionId)

export const accessTo = (url: string, sessionId: Session.ID) =>
  TestEnvironment.access({ url, environmentId, brain: Brain.ofSession(sessionId), directory: folder(sessionId) })

export const embedded = (replacements: Parameters<typeof createEmbeddedRoutes>[1]) =>
  createEmbeddedRoutes(
    {
      database: { path: ":memory:" },
      config: { project: false, content: vars.OPENCODE_CONFIG },
      models: { fetch: false },
      fs: { filewatcher: false, fff: false },
    },
    replacements,
  ).pipe(Layer.provide(HttpServer.layerServices))

export const open = Effect.fnUntraced(function* (confinement?: RenPlugin.Confinement) {
  const context = yield* Layer.build(TestAccess.memory(new Map()))
  const memory = Context.get(context, TestAccess.Memory)
  const opens = yield* Ref.make(0)
  const counted = Layer.succeed(
    EnvironmentAccess.Service,
    EnvironmentAccess.Service.of({
      release: () => Effect.void,
      open: (sessionId) =>
        Ref.update(opens, (count) => count + 1).pipe(
          Effect.andThen(Context.get(context, EnvironmentAccess.Service).open(sessionId)),
        ),
    }),
  )
  const environments = Context.get(
    yield* Layer.build(EnvironmentConnections.layer.pipe(Layer.provide(counted), Layer.provide(FetchHttpClient.layer))),
    EnvironmentConnections.Service,
  )
  const host = yield* OpenCodeServer.make(
    (replacements) => embedded([...replacements, ...RenWorkspaceDriver.replacements(environments)]),
    endpoints,
    () => Effect.succeedNone,
    Option.some(environments),
    { saved: Option.none(), directoryOf: () => local, ...(confinement && { confinement }) },
  )
  return {
    harness: yield* OpenCodeHarness.make(host, endpoints),
    memory,
    opens: Ref.get(opens),
    environments,
  }
})

export type Opened = Effect.Success<ReturnType<typeof open>>

export const sendTo = (
  harness: Harness.Instance,
  sessionId: Session.ID,
  script: StubModel.Script,
  delivery: Session.Delivery = "steer",
) =>
  harness.send({
    sessionId,
    messageId: Session.MessageID.create(),
    prompt: { text: `${script.marker} use the tool` },
    delivery,
    sender: { userId: "user_1" },
  })

export const restart = (harness: Harness.Instance, sessionId: Session.ID, directory?: string, modelId?: string) =>
  harness.start({
    sessionId,
    harness: "opencode",
    interactive: false,
    ...(directory && { directory }),
    ...(modelId && { model: { endpointId: "stub", modelId } }),
  })

// oxlint-disable-next-line ren/no-comments -- A result with an image is followed by a user message without the script's marker, so `script.called(2)` would not see that call.
export const answered = (script: StubModel.Script) =>
  Effect.promise(() =>
    stub.waitFor((call) => {
      const asked = call.body.messages.findLastIndex((message) => JSON.stringify(message).includes(script.marker))
      return call.kind === "turn" && asked >= 0 && call.body.messages.slice(asked + 1).some((m) => m.role === "tool")
    }),
  )

export const begin = Effect.fnUntraced(function* (opened: Opened, url?: string, modelId?: string) {
  const sessionId = Session.ID.create()
  yield* opened.memory.set(sessionId, yield* accessTo(url ?? (yield* TestEnvironment.url), sessionId))
  yield* restart(opened.harness, sessionId, folder(sessionId), modelId)
  return {
    sessionId,
    send: (script: StubModel.Script) => sendTo(opened.harness, sessionId, script),
    turn: (script: StubModel.Script) =>
      sendTo(opened.harness, sessionId, script).pipe(Effect.andThen(answered(script))),
  }
})

export const lastToolResult = (call: StubModel.Call) =>
  JSON.stringify(call.body.messages.findLast((message) => message.role === "tool")?.content ?? "")

export const shell = (command: string) => ({ tool: { name: "shell", input: { command } } })

export const shellWith = (command: string, more: Record<string, unknown>) => ({
  tool: { name: "shell", input: { command, ...more } },
})

export const scratch = () => Effect.promise(() => mkdtemp(join(workspace, "scratch-")))

export const stops = (pid: number, seconds: number) =>
  Effect.sync(() => !Processes.running(pid)).pipe(
    Effect.repeat({ until: Boolean, schedule: Schedule.spaced("100 millis") }),
    Effect.timeoutOption(Duration.seconds(seconds)),
    Effect.map(Option.isSome),
  )
