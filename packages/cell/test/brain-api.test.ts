import { expect, test } from "bun:test"
import { SessionID } from "@opencode/schema/session-id"
import {
  BrainRejectedError,
  ForbiddenError,
  ModelsNotConfiguredError,
  SessionNotStartedError,
} from "@ren/brain-api/errors"
import { testEffect } from "@ren/executor/testing"
import { Environment } from "@ren/schema/environment"
import type { Models } from "@ren/schema/models"
import { Session } from "@ren/schema/session"
import { Effect, type Scope } from "effect"
import { BrainTest } from "./lib/brain.js"
import { ModelsTest } from "./lib/models.js"
import { Shared } from "./lib/shared.js"

const it = testEffect(BrainTest.layer)

const live = <A, E>(body: Effect.Effect<A, E, BrainTest.Service | Scope.Scope>) =>
  body.pipe(Effect.scoped, Effect.provide(BrainTest.layer), Effect.runPromise)

const limit = { context: 100_000, output: 4000 }

const catalog = (
  models: ReadonlyArray<Models.Info>,
  apiKey = Shared.apiKey("catalog-key"),
  baseUrl = Shared.stub().url,
): Models.Access => ({ endpoints: [{ id: "stub", protocol: "openai-chat", baseUrl, apiKey, models }] })

const question = {
  name: "question",
  input: { questions: [{ question: "Which?", header: "Pick", options: [{ label: "A", description: "a" }] }] },
}

test.each<[Session.Delivery, Array<string>]>([
  ["steer", ["user", "assistant", "tool", "user"]],
  ["queue", ["user", "assistant", "tool", "assistant", "user"]],
])(
  "a %s message and a model switch during a turn reach the running turn with the delivery's semantics and serve every later dispatch",
  (delivery, roles) =>
    live(
      Effect.gen(function* () {
        const brain = yield* BrainTest.Service
        yield* brain.start({ interactive: false })
        const first = Shared.stub().script({ hold: true, tool: question })
        const second = Shared.stub().script()
        yield* brain.send(`first ${first.marker}`)
        yield* Effect.promise(() => first.called())
        yield* brain.start({ interactive: false, model: { endpointId: "stub", modelId: "stub-other" } })
        yield* brain.send(`second ${second.marker}`, { delivery })
        first.release()
        const sessionID = SessionID.make(brain.id)
        yield* brain.opencode.session.wait({ sessionID })
        expect(second.calls[0]?.body.messages.map((item) => item.role).filter((role) => role !== "system")).toEqual(
          roles,
        )
        const models = [...first.calls, ...second.calls].map((call) => call.body.model)
        expect(models[0]).toBe("stub-model")
        expect(new Set(models.slice(1))).toEqual(new Set(["stub-other"]))
        expect(yield* brain.opencode.session.get({ sessionID })).toMatchObject({ model: { id: "stub-other" } })
      }),
    ),
)

it.live("start creates a session with Ren's identity, model, agent and instructions", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    expect(
      yield* brain.start({
        title: "First",
        agent: "build",
        model: { endpointId: "stub", modelId: "stub-model" },
        instructions: { team: "Ren" },
      }),
    ).toEqual({ sessionId: brain.id, harness: "opencode" })
    const sessionID = SessionID.make(brain.id)
    expect(yield* brain.opencode.session.get({ sessionID })).toMatchObject({
      title: "First",
      agent: "build",
      model: { providerID: "stub", id: "stub-model" },
      location: { directory: brain.directory },
    })
    expect(yield* brain.opencode.session.instructions.entry.list({ sessionID })).toEqual([
      { key: "team", value: "Ren" },
    ])
    expect((yield* brain.state).nextReconcileAt).not.toBeNull()
  }),
)

it.live("start accepts its initial message after configuration and deduplicates concurrent and completed retries", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    const script = Shared.stub().script({ hold: true })
    yield* brain.start()
    yield* brain.configureModels({ stub: Shared.apiKey("initial-key") })
    const input = {
      instructions: { team: "Ren initial instructions" },
      interactive: false,
      initialMessage: {
        messageId: Session.MessageID.create(),
        prompt: { text: `initial ${script.marker}` },
        sender: { userId: "user_initial" },
      },
    } satisfies Partial<Session.StartInput>
    expect(yield* Effect.all([brain.start(input), brain.start(input)], { concurrency: 2 })).toEqual([
      { sessionId: brain.id, harness: "opencode" },
      { sessionId: brain.id, harness: "opencode" },
    ])
    const call = yield* Effect.promise(() => script.called())
    expect(call.system).toContain("Ren initial instructions")
    expect(call.authorization).toBe("Bearer initial-key")
    expect(call.tools).not.toContain("question")
    script.release()
    const sessionID = SessionID.make(brain.id)
    yield* brain.opencode.session.wait({ sessionID })
    const messages = (yield* brain.opencode.message.list({ sessionID })).data
    expect(messages.filter((message) => message.type === "user")).toMatchObject([
      { id: input.initialMessage.messageId, metadata: { userID: "user_initial" } },
    ])
    yield* brain.start(input)
    yield* brain.opencode.session.wait({ sessionID })
    expect((yield* brain.opencode.message.list({ sessionID })).data).toEqual(messages)
    expect(script.calls).toHaveLength(1)
  }),
)

it.live(
  "a repeated start updates title, agent, model and the whole instruction set without duplicating the session",
  () =>
    Effect.gen(function* () {
      const brain = yield* BrainTest.Service
      yield* brain.start({ title: "First", instructions: { team: "Ren", old: "remove" } })
      const input = {
        title: "Second",
        agent: "plan",
        model: { endpointId: "stub", modelId: "stub-other" },
        instructions: { team: "Ren", goal: "ship" },
      }
      expect(yield* brain.start(input)).toEqual(yield* brain.start(input))
      const sessionID = SessionID.make(brain.id)
      expect((yield* brain.opencode.session.list()).data).toHaveLength(1)
      expect(yield* brain.opencode.session.get({ sessionID })).toMatchObject({
        title: "Second",
        agent: "plan",
        model: { id: "stub-other" },
      })
      expect(yield* brain.opencode.session.instructions.entry.list({ sessionID })).toEqual([
        { key: "goal", value: "ship" },
        { key: "team", value: "Ren" },
      ])
    }),
)

it.live("a token-session mismatch fails before acquiring the harness", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    expect(yield* brain.start({ sessionId: Session.ID.create() }).pipe(Effect.flip)).toBeInstanceOf(ForbiddenError)
    expect(
      yield* brain.client.brain["brain.send"]({
        params: { id: Session.ID.create() },
        payload: {
          messageId: Session.MessageID.create(),
          prompt: { text: "hello" },
          delivery: "steer",
          sender: { userId: "user_1" },
        },
      }).pipe(Effect.flip),
    ).toBeInstanceOf(ForbiddenError)
    expect(yield* brain.state).toMatchObject({ isOpen: false, holders: 0, nextReconcileAt: null })
  }),
)

test.each<[string, Partial<Session.StartInput>]>([
  ["an unknown agent", { agent: "nobody" }],
  ["an unknown model", { model: { endpointId: "stub", modelId: "missing" } }],
  [
    "an environment in a brain that cannot use environments",
    { environments: [{ environmentId: Environment.ID.create(), directory: "/workspace" }] },
  ],
])("start rejects %s, creates no session and submits no initial message", (_name, input) =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.Service
      const script = Shared.stub().script()
      expect(
        yield* brain
          .start({
            ...input,
            initialMessage: {
              messageId: Session.MessageID.create(),
              prompt: { text: `initial ${script.marker}` },
              sender: { userId: "user_1" },
            },
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(BrainRejectedError)
      expect((yield* brain.opencode.session.list()).data).toEqual([])
      expect(script.calls).toEqual([])
    }),
  ),
)

it.live("send before start is a typed SessionNotStartedError", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    expect(yield* brain.send("early").pipe(Effect.flip)).toBeInstanceOf(SessionNotStartedError)
  }),
)

it.live(
  "send returns Accepted before completion, preserves sender metadata and deduplicates concurrent and completed sends",
  () =>
    Effect.gen(function* () {
      const brain = yield* BrainTest.Service
      yield* brain.start()
      const script = Shared.stub().script({ hold: true })
      const messageId = Session.MessageID.create()
      const input = { messageId, sender: { userId: "user_42" } }
      const answers = yield* Effect.all(
        [brain.send(`once ${script.marker}`, input), brain.send(`once ${script.marker}`, input)],
        { concurrency: 2 },
      )
      expect(answers).toEqual([{ messageId }, { messageId }])
      yield* Effect.promise(() => script.called())
      script.release()
      const sessionID = SessionID.make(brain.id)
      yield* brain.opencode.session.wait({ sessionID })
      const before = (yield* brain.opencode.message.list({ sessionID })).data
      yield* brain.send(`once ${script.marker}`, input)
      yield* brain.opencode.session.wait({ sessionID })
      expect((yield* brain.opencode.message.list({ sessionID })).data).toEqual(before)
      expect(before.find((message) => String(message.id) === messageId)).toMatchObject({
        type: "user",
        metadata: { userID: "user_42" },
      })
      expect(script.calls).toHaveLength(1)
    }),
)

it.live("instructions, non-interactive permissions and the Ren plugin reach the model", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    yield* brain.start({ interactive: true })
    yield* brain.start({ interactive: false, instructions: { team: "Ren builds cells" } })
    const script = Shared.stub().script()
    yield* brain.send(`tools ${script.marker}`)
    yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
    expect(script.calls[0]?.system).toContain("Ren builds cells")
    expect(
      script.calls[0]?.tools.filter((tool) =>
        ["read", "write", "edit", "patch", "glob", "grep", "shell", "question"].includes(tool),
      ),
    ).toEqual([])
    yield* brain.start({ interactive: true })
    const interactive = Shared.stub().script()
    yield* brain.send(`interactive ${interactive.marker}`)
    yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
    expect(interactive.calls[0]?.tools).toContain("question")
  }),
)

it.live("a busy start applies changes without interrupting the running turn", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    yield* brain.start()
    const script = Shared.stub().script({ hold: true })
    yield* brain.send(`busy ${script.marker}`)
    yield* Effect.promise(() => script.called())
    yield* brain.start({ title: "While busy", instructions: { team: "Ren" } })
    script.release()
    const sessionID = SessionID.make(brain.id)
    yield* brain.opencode.session.wait({ sessionID })
    expect(yield* brain.opencode.session.get({ sessionID })).toMatchObject({
      title: "While busy",
      outcome: "succeeded",
    })
    expect(script.calls).toHaveLength(1)
  }),
)

it.live("a configuration replaces the brain's credentials", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    const expires = Date.now() + 3_600_000
    yield* brain.start()
    yield* brain.configureModels({ stub: Shared.apiKey("old", expires), anthropic: Shared.apiKey("anthropic") })
    expect(yield* brain.credentials.all()).toHaveLength(2)
    yield* brain.configureModels({ stub: Shared.apiKey("new", expires + 1000) })
    const script = Shared.stub().script()
    yield* brain.send(`key ${script.marker}`)
    yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
    expect(script.calls[0]?.authorization).toBe("Bearer new")
    yield* brain.configureModels({ stub: Shared.apiKey("replacement") })
    expect((yield* brain.credentials.all()).map((credential) => credential.value)).toEqual([
      { type: "key", key: "replacement" },
    ])
  }),
)

it.live(
  "without models, start and send are refused before acquiring the harness, and removing models deletes the brain's credentials",
  () =>
    Effect.gen(function* () {
      const brain = yield* BrainTest.Service
      const refused = Effect.gen(function* () {
        expect(yield* brain.start().pipe(Effect.flip)).toBeInstanceOf(ModelsNotConfiguredError)
        expect(yield* brain.send("refused").pipe(Effect.flip)).toBeInstanceOf(ModelsNotConfiguredError)
      })
      yield* brain.removeModels
      yield* refused
      expect(yield* brain.state).toMatchObject({ isOpen: false, nextReconcileAt: null })
      yield* brain.configureModels()
      yield* brain.start()
      yield* brain.configureModels({ stub: Shared.apiKey("removed") })
      expect(yield* brain.credentials.all()).toHaveLength(1)
      yield* brain.removeModels
      expect(yield* brain.credentials.all()).toEqual([])
      yield* refused
      yield* brain.configureModels()
      expect(yield* brain.start()).toEqual({ sessionId: brain.id, harness: "opencode" })
    }),
)

it.live("an expiring key configured during a turn reaches its next model call", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    const expires = Date.now() + 3_600_000
    yield* brain.start()
    yield* brain.configureModels({ stub: Shared.apiKey("first", expires) })
    const first = Shared.stub().script({ hold: true })
    const second = Shared.stub().script()
    yield* brain.send(`first ${first.marker}`)
    yield* Effect.promise(() => first.called())
    yield* brain.configureModels({ stub: Shared.apiKey("second", expires + 1000) })
    yield* brain.send(`second ${second.marker}`)
    first.release()
    yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
    expect([first.calls[0]?.authorization, second.calls[0]?.authorization]).toEqual(["Bearer first", "Bearer second"])
  }),
)

it.live("an expired key refuses start and send without a model call until a fresh configuration", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    const expires = Date.now() - 1000
    yield* brain.start()
    yield* brain.configureModels({ stub: Shared.apiKey("expired", expires) })
    const script = Shared.stub().script()
    const refused = new ModelsNotConfiguredError({
      message: `Model refresh key expired: the key for endpoint stub expired at ${new Date(expires).toISOString()}`,
    })
    expect(yield* brain.send(`expired ${script.marker}`).pipe(Effect.flip)).toEqual(refused)
    expect(yield* brain.start().pipe(Effect.flip)).toEqual(refused)
    expect(script.calls).toEqual([])
    yield* brain.configureModels({ stub: Shared.apiKey("fresh", Date.now() + 3_600_000) })
    const fresh = Shared.stub().script()
    yield* brain.send(`fresh ${fresh.marker}`)
    yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
    expect(fresh.calls[0]?.authorization).toBe("Bearer fresh")
  }),
)

it.live(
  "a model and an endpoint added while the harness is open are listed with their metadata and serve the next turns",
  () =>
    Effect.gen(function* () {
      const brain = yield* BrainTest.Service
      yield* brain.start()
      yield* brain.client.brain["brain.configureModels"]({
        payload: {
          access: {
            endpoints: [
              ...catalog([
                { id: "stub-model", name: "Stub", limit },
                {
                  id: "stub-added",
                  name: "Stub Added",
                  limit: { context: 50_000, output: 2000 },
                  efforts: ["low", "high"],
                },
              ]).endpoints,
              ...Shared.access({ later: Shared.apiKey("later") }, Shared.stub().url).endpoints,
            ],
          },
        },
      })
      const added = (yield* brain.opencode.model.list()).data.find(
        (model) => model.providerID === "stub" && model.modelID === "stub-added",
      )
      expect(added).toMatchObject({
        name: "Stub Added",
        limit: { context: 50_000, output: 2000 },
        variants: [
          { id: "low", settings: { reasoningEffort: "low" } },
          { id: "high", settings: { reasoningEffort: "high" } },
        ],
      })
      expect(added?.variants).toHaveLength(2)
      const sessionID = SessionID.make(brain.id)
      yield* brain.start({ model: { endpointId: "stub", modelId: "stub-added", variant: "high" } })
      const script = Shared.stub().script()
      yield* brain.send(`added ${script.marker}`)
      yield* brain.opencode.session.wait({ sessionID })
      yield* brain.start({ model: { endpointId: "later", modelId: "stub-model" } })
      const later = Shared.stub().script()
      yield* brain.send(`later ${later.marker}`)
      yield* brain.opencode.session.wait({ sessionID })
      expect([...script.calls, ...later.calls].map((call) => [call.body.model, call.authorization])).toEqual([
        ["stub-added", "Bearer catalog-key"],
        ["stub-model", "Bearer later"],
      ])
    }),
)

it.live("an anthropic endpoint becomes a provider with its efforts as variants, and its key reaches the model", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    yield* brain.start()
    yield* brain.client.brain["brain.configureModels"]({
      payload: {
        access: {
          endpoints: [
            {
              id: "gateway-anthropic",
              protocol: "anthropic-messages",
              baseUrl: Shared.stub().url,
              apiKey: Shared.apiKey("anthropic-key", Date.now() + 3_600_000),
              models: [{ id: "stub-claude", name: "Gateway Claude", limit, efforts: ["low", "max"] }],
            },
          ],
        },
      },
    })
    expect(
      (yield* brain.opencode.model.list()).data
        .filter((model) => model.providerID === "gateway-anthropic")
        .map((model) => model.variants.map((variant) => ({ id: String(variant.id), settings: variant.settings }))),
    ).toEqual([
      [
        { id: "low", settings: { thinking: { type: "adaptive", display: "summarized" }, effort: "low" } },
        { id: "max", settings: { thinking: { type: "adaptive", display: "summarized" }, effort: "max" } },
      ],
    ])
    yield* brain.start({ model: { endpointId: "gateway-anthropic", modelId: "stub-claude" } })
    const script = Shared.stub().script()
    yield* brain.send(`anthropic ${script.marker}`)
    yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
    expect(script.calls.map((call) => [call.path, call.authorization, call.apiKey])).toEqual([
      ["/v1/messages", "Bearer anthropic-key", null],
    ])
  }),
)

it.live("a model removed from the catalog while the harness is open is no longer listed or selectable", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    yield* brain.start()
    yield* brain.client.brain["brain.configureModels"]({
      payload: {
        access: catalog([
          { id: "stub-model", limit },
          { id: "stub-added", limit },
        ]),
      },
    })
    yield* brain.client.brain["brain.configureModels"]({ payload: { access: catalog([{ id: "stub-model", limit }]) } })
    expect(
      (yield* brain.opencode.model.list()).data.filter(
        (model) => model.providerID === "stub" && model.modelID === "stub-added",
      ),
    ).toEqual([])
    expect(
      yield* brain.start({ model: { endpointId: "stub", modelId: "stub-added" } }).pipe(Effect.flip),
    ).toBeInstanceOf(BrainRejectedError)
  }),
)

test.each<[string, Models.Access, Models.Access, Session.Model]>([
  [
    "a model removed from its endpoint",
    catalog([
      { id: "stub-model", limit },
      { id: "stub-added", limit },
    ]),
    catalog([{ id: "stub-model", limit }]),
    { endpointId: "stub", modelId: "stub-added" },
  ],
  [
    "an endpoint removed",
    Shared.access({ stub: Shared.apiKey("stub-ren"), later: Shared.apiKey("later") }, Shared.stub().url),
    Shared.access({ stub: Shared.apiKey("stub-ren") }, Shared.stub().url),
    { endpointId: "later", modelId: "stub-model" },
  ],
])("the selected model removed while the harness is open (%s) sends no model request", (_name, before, after, model) =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.Service
      yield* brain.start()
      yield* brain.client.brain["brain.configureModels"]({ payload: { access: before } })
      yield* brain.start({ model })
      yield* brain.client.brain["brain.configureModels"]({ payload: { access: after } })
      const script = Shared.stub().script()
      yield* Effect.exit(brain.send(`removed ${script.marker}`))
      yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
      expect(script.calls).toEqual([])
    }),
  ),
)

test.todo("REN-1486 an endpoint's base URL and key changed during a turn reach the next model request", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.Service
      yield* brain.start()
      yield* brain.client.brain["brain.configureModels"]({
        payload: { access: catalog([{ id: "stub-model", limit }], Shared.apiKey("first-key")) },
      })
      const first = Shared.stub().script({ hold: true })
      const second = Shared.stub().script()
      yield* brain.send(`first ${first.marker}`)
      yield* Effect.promise(() => first.called())
      yield* brain.client.brain["brain.configureModels"]({
        payload: {
          access: catalog(
            [{ id: "stub-model", limit }],
            Shared.apiKey("moved-key"),
            Shared.stub().url.replace(/\/v1$/, "/moved/v1"),
          ),
        },
      })
      yield* brain.send(`second ${second.marker}`, { delivery: "queue" })
      first.release()
      yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
      expect([...first.calls, ...second.calls].map((call) => [call.path, call.authorization])).toEqual([
        ["/v1/chat/completions", "Bearer first-key"],
        ["/moved/v1/chat/completions", "Bearer moved-key"],
      ])
    }),
  ),
)

it.live("a key inside OpenCode's refresh window is renewed through the host before the model request", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    yield* brain.start()
    yield* brain.configureModels({ stub: Shared.apiKey("expiring", Date.now() + 60_000) }, "host-token")
    const script = Shared.stub().script()
    yield* brain.send(`renew ${script.marker}`)
    yield* brain.issuer.reply(
      yield* brain.issuer.next,
      ModelsTest.granted({
        access: Shared.access({ stub: Shared.apiKey("renewed", Date.now() + 3_600_000) }, Shared.stub().url),
        hostToken: "next-token",
      }),
    )
    yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
    expect(script.calls.map((call) => call.authorization)).toEqual(["Bearer renewed"])
    expect(brain.issuer.requests).toEqual(["Bearer host-token"])
  }),
)
