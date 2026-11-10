import { expect } from "bun:test"
import { Session } from "@opencode/client/effect"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { testEffect } from "@ren/executor/testing"
import { Auth } from "@ren/schema/auth"
import type { Models } from "@ren/schema/models"
// ast-grep-ignore: no-import-alias -- OpenCode's Session is imported too, and both are values
import { Session as RenSession } from "@ren/schema/session"
import { Usage } from "@ren/schema/usage"
import { Context, Effect, Layer, Option, Redacted } from "effect"
import { HttpServer } from "effect/http"
import { mkdir, mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OpenCodeHarness } from "../src/harness/opencode/harness.js"
import { OpenCodeServer } from "../src/harness/opencode/server.js"
import { ModelCatalog } from "../src/model-catalog.js"
import { ModelsTest } from "./lib/models.js"
import { Shared } from "./lib/shared.js"
import { SettingsHarness } from "./lib/settings-harness.js"
import { TestSettings } from "./lib/settings.js"

const it = testEffect(Layer.empty)

const stub = Shared.stub()

it.live("Ren's catalog reaches OpenCode when it changes, and stays when a pull brings none (tests 34, 35)", () =>
  Effect.gen(function* () {
    const catalog = Context.get(
      yield* Layer.build(ModelCatalog.layer.pipe(Layer.provide(ModelsTest.storage()))),
      ModelCatalog.Service,
    )
    const opened = yield* SettingsHarness.open(TestSettings.layers(), {
      catalog,
      refreshKey: (id) => Effect.succeed(id === "ren" ? Option.some({ key: Redacted.make("ren-key") }) : Option.none()),
    })
    const listed = opened.client.model
      .list()
      .pipe(
        Effect.map((page) => page.data.filter((model) => model.providerID === "ren").map((model) => String(model.id))),
      )
    const ren = (ids: ReadonlyArray<string>): Models.Catalog => ({
      endpoints: [
        {
          id: "ren",
          protocol: "openai-chat",
          baseUrl: stub.url,
          models: ids.map((id) => ({ id, type: "chat" as const, protocol: "openai-chat" as const })),
        },
      ],
    })
    yield* opened.harness.refreshModels
    expect(yield* listed).toEqual([])
    yield* catalog.save(ren(["stub/stub-model"]))
    yield* opened.harness.refreshModels
    expect(yield* listed).toEqual(["stub/stub-model"])
    yield* opened.harness.refreshModels
    expect(yield* listed).toEqual(["stub/stub-model"])
    yield* catalog.save(ren(["stub/stub-model", "stub/stub-new"]))
    yield* opened.harness.refreshModels
    expect((yield* listed).toSorted()).toEqual(["stub/stub-model", "stub/stub-new"])
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
  const idle = server.client.experimental.session.wait({ sessionID: Session.ID.make(sessionId) }).pipe(Effect.orDie)
  return { sessionId, send, idle }
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

it.live(
  "a subagent request names its root chat, its own session, the root turn and the sender of the root turn; a title request names nobody",
  () =>
    Effect.gen(function* () {
      const chat = yield* chatWith()
      const child = stub.script()
      const parent = stub.script({
        tool: { name: "subagent", input: { agent: "general", description: "look around", prompt: child.marker } },
      })
      const sent = yield* chat.send(parent.marker, ada)
      yield* chat.idle
      const title = yield* Effect.promise(() =>
        stub.waitFor((call) => call.kind === "title" && JSON.stringify(call.body).includes(parent.marker)),
      )
      const parentCall = yield* Effect.promise(() => parent.called())
      const childCall = yield* Effect.promise(() => child.called())
      const claims = (call: typeof childCall) =>
        Object.fromEntries(Object.entries(Usage.headers).map((entry) => [entry[0], call.headers.get(entry[1])]))
      expect([claims(parentCall), claims(childCall), claims(title)]).toEqual([
        {
          rootSession: chat.sessionId,
          session: chat.sessionId,
          turn: sent.messageId,
          agent: "build",
          kind: "primary",
          variant: null,
        },
        {
          rootSession: chat.sessionId,
          session: expect.not.stringMatching(chat.sessionId),
          turn: sent.messageId,
          agent: "general",
          kind: "primary",
          variant: null,
        },
        {
          rootSession: chat.sessionId,
          session: chat.sessionId,
          turn: sent.messageId,
          agent: "title",
          kind: "title",
          variant: null,
        },
      ])
      expect([childCall.member, title.member]).toEqual([ada, null])
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
