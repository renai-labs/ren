import { expect } from "bun:test"
import { Session } from "@opencode/client/effect"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { testEffect } from "@ren/executor/testing"
import { Auth } from "@ren/schema/auth"
import type { Models } from "@ren/schema/models"
// ast-grep-ignore: no-import-alias -- OpenCode's Session is imported too, and both are values
import { Session as RenSession } from "@ren/schema/session"
import { Usage } from "@ren/schema/usage"
import { Effect, Layer, Option } from "effect"
import { HttpServer } from "effect/http"
import { mkdir, mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OpenCodeHarness } from "../src/harness/opencode/harness.js"
import { OpenCodeServer } from "../src/harness/opencode/server.js"
import { Shared } from "./lib/shared.js"

const it = testEffect(Layer.empty)

const stub = Shared.stub()

const ada = Auth.MemberID.create()

// oxlint-disable-next-line ren/no-comments -- OpenAI on the subscription method with a ChatGPT seat model and its client settings, and Ren with one model on the Claude runtime and one on HTTP, as the pull brings them (providers §7.2, §7.3).
const endpoints = (): ReadonlyArray<Models.Endpoint> => [
  {
    id: "openai",
    protocol: "openai-responses",
    baseUrl: stub.url,
    apiKey: Shared.apiKey("stub-key"),
    method: "subscription",
    models: [
      {
        id: "stub-gpt",
        type: "chat",
        protocol: "openai-chat",
        gateway: "seat/openai/stub-gpt",
        limit: { context: 100_000, output: 4000 },
        client: { effortUpdates: false, compaction: "summary", cost: false },
      },
    ],
  },
  {
    protocol: "openai-chat",
    baseUrl: stub.url,
    apiKey: Shared.apiKey("stub-key"),
    keyHeader: "x-gateway-key",
    id: "ren",
    models: [
      {
        id: "anthropic/stub-claude",
        type: "chat",
        protocol: "anthropic-messages",
        gateway: "ren/anthropic/stub-claude",
        runtime: "claude",
        efforts: ["low", "high"],
        limit: { context: 100_000, output: 4000 },
      },
      {
        id: "stub/stub-model",
        type: "chat",
        protocol: "openai-chat",
        gateway: "ren/stub/stub-model",
        limit: { context: 100_000, output: 4000 },
      },
    ],
  },
]

const chatOn = Effect.fnUntraced(function* (endpointId: string, modelId: string) {
  const listed = endpoints()
  const directory = yield* Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), "ren-claude-"))))
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
    listed,
    () => Effect.succeedNone,
    Option.none(),
    {
      saved: Option.none(),
      directoryOf: (sessionId) => join(directory, sessionId),
      makeDirectory: (path) => Effect.promise(() => mkdir(path, { recursive: true })),
    },
  )
  const harness = yield* OpenCodeHarness.make(server, listed)
  const sessionId = RenSession.ID.create()
  yield* harness.start({ sessionId, harness: "opencode", interactive: true })
  yield* harness.setModel(sessionId, Option.some({ endpointId, modelId }))
  const send = (marker: string) =>
    harness.send({
      sessionId,
      messageId: RenSession.MessageID.create(),
      prompt: { text: marker },
      delivery: "steer",
      sender: { userId: `usr_${ada}`, memberId: ada },
    })
  const idle = server.client.experimental.session.wait({ sessionID: Session.ID.make(sessionId) }).pipe(Effect.orDie)
  return { sessionId, send, idle, harness, server }
})

it.live(
  "a Claude model runs on `claude` through the inference service, under Ren's card, with Ren's key as its login and the usage headers that stay the same for the chat",
  () =>
    Effect.gen(function* () {
      const chat = yield* chatOn("ren", "anthropic/stub-claude")
      const script = stub.script({ reply: "hello from claude" })
      yield* chat.send(script.marker)
      const call = yield* Effect.promise(() => script.called())
      yield* chat.idle
      expect({
        path: call.path,
        model: call.body.model,
        key: call.headers.get("x-gateway-key"),
        litellm: call.headers.get("x-litellm-api-key"),
        authorization: call.authorization,
        client: call.headers.get("user-agent")?.split("/")[0],
        session: call.headers.get(Usage.headers.session),
        kind: call.headers.get(Usage.headers.kind),
        member: call.member,
      }).toEqual({
        path: "/v1/messages",
        model: "ren/anthropic/stub-claude",
        key: "Bearer stub-key",
        litellm: null,
        authorization: "Bearer stub-key",
        client: "claude-cli",
        session: chat.sessionId,
        kind: null,
        member: ada,
      })
      const page = yield* chat.harness.chat.messages(chat.sessionId, {})
      expect(JSON.stringify(page)).toContain("hello from claude")
      expect(JSON.stringify(page)).toContain('"providerID":"ren"')
    }),
)

it.live("a model's client settings reach OpenCode, as a ChatGPT seat model carries them", () =>
  Effect.gen(function* () {
    const chat = yield* chatOn("openai", "stub-gpt")
    const page = yield* chat.server.client.model.list().pipe(Effect.orDie)
    const model = page.data.find((each) => each.providerID === "openai" && each.id === "stub-gpt")
    expect({
      supportsEffortUpdates: model?.compatibility?.supportsEffortUpdates,
      compaction: model?.settings?.compaction,
      cost: model?.cost,
    }).toEqual({ supportsEffortUpdates: false, compaction: { type: "summary" }, cost: [] })
  }),
)
