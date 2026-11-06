export * as ReferenceChat from "./reference-chat.js"

import { SessionID } from "@opencode/schema/session-id"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { EnvironmentConnections } from "@ren/brain/environment/connections"
import { TestAccess, type TestGitHub } from "@ren/brain/testing"
import { TestEnvironment } from "@ren/executor/testing"
import type { PullChat } from "@ren/host-api/ren-host-api"
import { Brain } from "@ren/schema/brain"
import type { Drive } from "@ren/schema/drive"
import type { Environment } from "@ren/schema/environment"
import type { Reference } from "@ren/schema/reference"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import { Context, Effect, Layer, Option } from "effect"
import { FetchHttpClient, HttpServer } from "effect/http"
import { ChatSettings } from "../../src/chat-settings.js"
import { GitSources } from "../../src/git-sources.js"
import { OpenCodeHarness } from "../../src/harness/opencode/harness.js"
import { OpenCodeServer } from "../../src/harness/opencode/server.js"
import { RenWorkspaceDriver } from "../../src/harness/opencode/workspace-driver.js"
import { ModelsTest } from "./models.js"
import { TestSettings } from "./settings.js"
import { Shared } from "./shared.js"
import type { StubModel } from "./stub-model.js"

export interface Place {
  readonly url: string | URL
  readonly environmentId: Environment.ID
  readonly directoryOf: (sessionId: string) => string
}

export const open = Effect.fnUntraced(function* (
  place: Place,
  github: TestGitHub.Instance,
  references: ReadonlyArray<Reference.Info>,
  drives?: Drive.Availability,
) {
  const stub = Shared.stub()
  const sessionId = Session.ID.create()
  const context = yield* Layer.build(TestAccess.memory(new Map()))
  const memory = Context.get(context, TestAccess.Memory)
  const environments = Context.get(
    yield* Layer.build(
      EnvironmentConnections.layer.pipe(
        Layer.provide(Layer.succeedContext(context)),
        Layer.provide(FetchHttpClient.layer),
      ),
    ),
    EnvironmentConnections.Service,
  )
  const settings = Context.get(
    yield* Layer.build(ChatSettings.layer.pipe(Layer.provide(ModelsTest.storage()))),
    ChatSettings.Service,
  )
  yield* settings.save(
    TestSettings.layers({ ren: { references } }),
    drives ? [{ id: sessionId, agent: null, archived: false, drives }] : [],
  )
  const endpoints = Shared.access(undefined, stub.url).endpoints
  const host = yield* OpenCodeServer.make(
    (replacements) =>
      createEmbeddedRoutes(
        {
          database: { path: ":memory:" },
          config: { project: false, content: Shared.vars(stub.url).OPENCODE_CONFIG },
          models: { fetch: false },
          fs: { filewatcher: false, fff: false },
        },
        [...replacements, ...RenWorkspaceDriver.replacements(environments)],
      ).pipe(Layer.provide(HttpServer.layerServices)),
    endpoints,
    () => Effect.succeedNone,
    Option.some(environments),
    {
      saved: Option.some(settings.saved),
      directoryOf: place.directoryOf,
      sources: yield* GitSources.make({ github: Effect.succeed(github.hosts), references: { refresh: 0, retry: 0 } }),
    },
  )
  const harness = yield* OpenCodeHarness.make(host, endpoints, Option.some(settings))
  const directory = place.directoryOf(sessionId)
  const accessOf = (generation: number) =>
    TestEnvironment.access({
      url: String(place.url),
      environmentId: place.environmentId,
      brain: Brain.ofSession(sessionId),
      directory,
      generation,
    })
  yield* memory.set(sessionId, yield* accessOf(1))
  yield* harness.start({ sessionId, harness: "opencode", interactive: false, directory })
  const turn = (script: StubModel.Script, calls = 2, prompt: Omit<Session.Prompt, "text"> = {}) =>
    harness
      .send({
        sessionId,
        messageId: Session.MessageID.create(),
        prompt: { ...prompt, text: `${script.marker} go` },
        delivery: "steer",
        sender: { userId: "user_1" },
      })
      .pipe(
        Effect.andThen(Effect.promise(() => script.called(calls))),
        Effect.tap(() => host.client.session.wait({ sessionID: SessionID.make(sessionId) }).pipe(Effect.orDie)),
      )
  return {
    sessionId,
    turn,
    prompt: (files: ReadonlyArray<Session.DriveFile>, text = "Look at these") =>
      harness.chat.prompt(sessionId, {
        id: SessionMessage.ID.create(),
        text,
        delivery: "steer",
        files,
        sender: Option.none(),
      }),
    wait: host.client.session.wait({ sessionID: SessionID.make(sessionId) }).pipe(Effect.orDie),
    messages: host.client.message.list({ sessionID: SessionID.make(sessionId) }).pipe(Effect.orDie),
    transcript: harness.chat.messages(sessionId, {}).pipe(Effect.orDie),
    tool: (name: string, input: unknown) => turn(stub.script({ tool: { name, input } })),
    replace: (generation: number) => Effect.flatMap(accessOf(generation), (access) => memory.set(sessionId, access)),
    forget: memory.remove(sessionId),
    read: host.client.session.get({ sessionID: SessionID.make(sessionId) }).pipe(Effect.orDie),
    pull: (next: ReadonlyArray<Reference.Info>, chat: Pick<PullChat, "hasHand"> = {}) =>
      Effect.gen(function* () {
        yield* settings.save(TestSettings.layers({ ren: { references: next } }), [])
        yield* harness.configure({
          settings: {
            layers: yield* settings.layers,
            chats: [{ id: sessionId, agent: null, archived: false, ...chat }],
          },
        })
        yield* Shared.appsSettled(harness)
      }),
  }
})
