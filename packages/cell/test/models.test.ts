import { expect } from "bun:test"
import { Session } from "@opencode/client/effect"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { testEffect } from "@ren/executor/testing"
import { Auth } from "@ren/schema/auth"
import type { Models } from "@ren/schema/models"
// ast-grep-ignore: no-import-alias -- OpenCode's Session is imported too, and both are values
import { Session as RenSession } from "@ren/schema/session"
import { Context, Effect, Layer, Option, Redacted } from "effect"
import { FetchHttpClient, HttpServer } from "effect/http"
import { mkdir, mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OpenCodeHarness } from "../src/harness/opencode/harness.js"
import { OpenCodeModels } from "../src/harness/opencode/models.js"
import { OpenCodeServer } from "../src/harness/opencode/server.js"
import { Inference } from "../src/inference.js"
import { ModelsTest } from "./lib/models.js"
import { Shared } from "./lib/shared.js"
import { StubModel } from "./lib/stub-model.js"

const it = testEffect(Layer.empty)

const stub = Shared.stub()

const reader = Effect.gen(function* () {
  const inference = Context.get(
    yield* Layer.build(Inference.layer.pipe(Layer.provide(ModelsTest.storage()))),
    Inference.Service,
  )
  yield* inference.saveBaseUrl(Option.some(stub.root))
  const applied: Array<ReadonlyArray<string>> = []
  const models = yield* OpenCodeModels.make({
    inference,
    keyFor: () => Effect.succeed(Option.some({ key: Redacted.make("stub-key") })),
    apply: (endpoints: ReadonlyArray<Models.Endpoint>) =>
      Effect.sync(() => {
        applied.push(endpoints.flatMap((endpoint) => endpoint.models.map((model) => `${endpoint.id}/${model.id}`)))
      }),
  }).pipe(Effect.provide(FetchHttpClient.layer))
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      stub.modelInfo.down(false)
      stub.modelInfo.set(StubModel.defaultModels)
    }),
  )
  return { inference, refresh: models.refresh, applied }
})

it.live("LiteLLM down at boot leaves the brain without a list until it answers, then the list arrives (test 34)", () =>
  Effect.gen(function* () {
    stub.modelInfo.down(true)
    const opened = yield* reader
    yield* opened.refresh
    expect(yield* opened.inference.catalog).toEqual(Option.none())
    stub.modelInfo.down(false)
    yield* opened.refresh
    expect(Option.map(yield* opened.inference.catalog, (catalog) => catalog.endpoints.map((each) => each.id))).toEqual(
      Option.some(["anthropic", "stub"]),
    )
  }),
)

it.live("LiteLLM down after a read keeps the last list: models do not go and come back (test 35)", () =>
  Effect.gen(function* () {
    const opened = yield* reader
    yield* opened.refresh
    const first = opened.applied.length
    const stored = yield* opened.inference.catalog
    stub.modelInfo.down(true)
    yield* opened.refresh
    expect(opened.applied).toHaveLength(first)
    expect(yield* opened.inference.catalog).toEqual(stored)
    stub.modelInfo.set([...StubModel.defaultModels, StubModel.modelEntry("stub", "stub-new")])
    stub.modelInfo.down(false)
    yield* opened.refresh
    expect(opened.applied.at(-1)).toContain("stub/stub-new")
  }),
)

const ada = Auth.MemberID.create()

const grace = Auth.MemberID.create()

const chatWith = Effect.fnUntraced(function* (options: { readonly egress?: boolean } = {}) {
  const access = Shared.access(undefined, stub.url)
  const directory = yield* Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), "ren-member-"))))
  const server = yield* OpenCodeServer.make(
    (replacements) =>
      createEmbeddedRoutes(
        {
          database: { path: ":memory:" },
          config: { directory, project: false, content: Shared.vars(stub.url).OPENCODE_CONFIG },
          models: { fetch: false },
          fs: { filewatcher: false, fff: false },
        },
        replacements,
      ).pipe(Layer.provide(HttpServer.layerServices)),
    access.endpoints,
    () => Effect.succeedNone,
    Option.none(),
    {
      saved: Option.none(),
      directoryOf: (sessionId) => join(directory, sessionId),
      makeDirectory: (path) => Effect.promise(() => mkdir(path, { recursive: true })),
      ...(options.egress && { egress: true }),
    },
  )
  const harness = yield* OpenCodeHarness.make(server, access.endpoints)
  const sessionId = RenSession.ID.create()
  yield* harness.start({ sessionId, harness: "opencode", interactive: true })
  const send = (marker: string, memberId: typeof Auth.MemberID.Type) =>
    harness.send({
      sessionId,
      messageId: RenSession.MessageID.create(),
      prompt: { text: marker },
      delivery: "steer",
      sender: { userId: `usr_${memberId}`, memberId },
    })
  const idle = server.client.session.wait({ sessionID: Session.ID.make(sessionId) }).pipe(Effect.orDie)
  return { send, idle }
})

it.live(
  "each step names the sender of the newest user message: a steer in one drain moves the next step to its sender",
  () =>
    Effect.gen(function* () {
      const chat = yield* chatWith()
      const first = stub.script({ hold: true })
      const second = stub.script()
      yield* chat.send(first.marker, ada)
      yield* Effect.promise(() => first.called())
      yield* chat.send(second.marker, grace)
      first.release()
      yield* chat.idle
      expect([
        (yield* Effect.promise(() => first.called())).member,
        (yield* Effect.promise(() => second.called())).member,
      ]).toEqual([ada, grace])
    }),
)

it.live("a subagent request names the sender of its root turn; a title request names nobody", () =>
  Effect.gen(function* () {
    const chat = yield* chatWith()
    const child = stub.script()
    const parent = stub.script({
      tool: { name: "subagent", input: { agent: "general", description: "look around", prompt: child.marker } },
    })
    yield* chat.send(parent.marker, ada)
    yield* chat.idle
    const title = yield* Effect.promise(() =>
      stub.waitFor((call) => call.kind === "title" && JSON.stringify(call.body).includes(parent.marker)),
    )
    expect([(yield* Effect.promise(() => child.called())).member, title.member]).toEqual([ada, null])
  }),
)

it.live("behind the egress a step names its sender by placeholder, which the egress checks", () =>
  Effect.gen(function* () {
    const chat = yield* chatWith({ egress: true })
    const script = stub.script()
    yield* chat.send(script.marker, ada)
    yield* chat.idle
    expect((yield* Effect.promise(() => script.called())).member).toBe(`ren:PERSON.${ada}`)
  }),
)
