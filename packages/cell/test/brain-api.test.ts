import { expect } from "bun:test"
import { SessionID } from "@opencode/schema/session-id"
import {
  BrainRejectedError,
  ForbiddenError,
  ModelsNotConfiguredError,
  SessionNotStartedError,
} from "@ren/brain-api/errors"
import { Session } from "@ren/schema/session"
import { Effect } from "effect"
import { BrainTest } from "./lib/brain.js"
import { Testing } from "./lib/effect.js"
import { Shared } from "./lib/shared.js"

const it = Testing.testEffect(BrainTest.layer)

const deliveries: ReadonlyArray<Session.Delivery> = ["steer", "queue"]
for (const delivery of deliveries) {
  it.live(`${delivery} reaches the running turn with the requested delivery semantics`, () =>
    Effect.gen(function* () {
      const brain = yield* BrainTest.Service
      yield* brain.start({ interactive: false })
      const first = Shared.stub().script({
        hold: true,
        tool: {
          name: "question",
          input: { questions: [{ question: "Which?", header: "Pick", options: [{ label: "A", description: "a" }] }] },
        },
      })
      const second = Shared.stub().script()
      yield* brain.send(`first ${first.marker}`)
      yield* Effect.promise(() => first.called())
      yield* brain.send(`second ${second.marker}`, { delivery })
      first.release()
      yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
      expect(second.calls[0]?.body.messages.map((item) => item.role).filter((role) => role !== "system")).toEqual(
        delivery === "steer"
          ? ["user", "assistant", "tool", "user"]
          : ["user", "assistant", "tool", "assistant", "user"],
      )
    }),
  )
}

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
    expect((yield* brain.client.brain["brain.state"]()).nextReconcileAt).not.toBeNull()
  }),
)

it.live("start accepts its initial message after configuration and deduplicates concurrent and completed retries", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    const script = Shared.stub().script({ hold: true })
    yield* brain.start()
    yield* brain.models({ stub: Shared.apiKey("initial-key") })
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

it.live("a retried start can submit its initial message when the session already exists without that message", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    yield* brain.start()
    const script = Shared.stub().script()
    const messageId = Session.MessageID.create()
    yield* brain.start({
      initialMessage: { messageId, prompt: { text: `initial ${script.marker}` }, sender: { userId: "user_1" } },
    })
    const sessionID = SessionID.make(brain.id)
    yield* brain.opencode.session.wait({ sessionID })
    expect(
      (yield* brain.opencode.message.list({ sessionID })).data.filter((message) => String(message.id) === messageId),
    ).toHaveLength(1)
    expect(script.calls).toHaveLength(1)
  }),
)

it.live("a rejected start submits no initial message", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    const script = Shared.stub().script()
    expect(
      yield* brain
        .start({
          agent: "missing",
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
    expect(yield* brain.client.brain["brain.state"]()).toMatchObject({
      isOpen: false,
      holders: 0,
      nextReconcileAt: null,
    })
  }),
)

it.live("unknown agents and models are typed rejections and create no session", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    const inputs: ReadonlyArray<Partial<Session.StartInput>> = [
      { agent: "nobody" },
      { model: { endpointId: "stub", modelId: "missing" } },
    ]
    for (const input of inputs) expect(yield* brain.start(input).pipe(Effect.flip)).toBeInstanceOf(BrainRejectedError)
    expect((yield* brain.opencode.session.list()).data).toEqual([])
  }),
)

it.live("start and send without a model configuration fail before acquiring the harness", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    brain.stored.clear()
    expect(yield* brain.start().pipe(Effect.flip)).toBeInstanceOf(ModelsNotConfiguredError)
    expect(yield* brain.send("early").pipe(Effect.flip)).toBeInstanceOf(ModelsNotConfiguredError)
    expect(yield* brain.client.brain["brain.state"]()).toMatchObject({ isOpen: false, nextReconcileAt: null })
    yield* brain.models()
    expect(yield* brain.start()).toEqual({ sessionId: brain.id, harness: "opencode" })
  }),
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

it.live("a configuration replaces the brain's credentials, and an older expiring key never replaces a newer one", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    const expires = Date.now() + 3_600_000
    yield* brain.start()
    yield* brain.models({
      stub: Shared.apiKey("old", expires),
      anthropic: Shared.apiKey("anthropic"),
    })
    expect(yield* brain.credentials.all()).toHaveLength(2)
    yield* brain.models({ stub: Shared.apiKey("new", expires + 1000) })
    const script = Shared.stub().script()
    yield* brain.send(`key ${script.marker}`)
    const sessionID = SessionID.make(brain.id)
    yield* brain.opencode.session.wait({ sessionID })
    expect(script.calls[0]?.authorization).toBe("Bearer new")
    yield* brain.models({ stub: Shared.apiKey("old", expires) })
    expect((yield* brain.credentials.all()).map((credential) => credential.value)).toMatchObject([
      { type: "oauth", access: "new" },
    ])
    yield* brain.models({ stub: Shared.apiKey("replacement") })
    expect((yield* brain.credentials.all()).map((credential) => credential.value)).toEqual([
      { type: "key", key: "replacement" },
    ])
  }),
)

it.live(
  "removing the models deletes the brain's credentials and refuses start and send until a new configuration",
  () =>
    Effect.gen(function* () {
      const brain = yield* BrainTest.Service
      yield* brain.start()
      yield* brain.models({ stub: Shared.apiKey("removed") })
      expect(yield* brain.credentials.all()).toHaveLength(1)
      yield* brain.removeModels
      expect(yield* brain.credentials.all()).toEqual([])
      expect(yield* brain.start().pipe(Effect.flip)).toBeInstanceOf(ModelsNotConfiguredError)
      expect(yield* brain.send("after removal").pipe(Effect.flip)).toBeInstanceOf(ModelsNotConfiguredError)
      yield* brain.models()
      expect(yield* brain.start()).toEqual({ sessionId: brain.id, harness: "opencode" })
    }),
)

it.live("a connection the open harness does not know waits for the next open", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    yield* brain.start()
    yield* brain.models({ later: Shared.apiKey("later") })
    expect(yield* brain.credentials.all()).toEqual([])
  }),
)

it.live("an expiring key configured during a turn reaches its next model call", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    const expires = Date.now() + 3_600_000
    yield* brain.start()
    yield* brain.models({ stub: Shared.apiKey("first", expires) })
    const first = Shared.stub().script({ hold: true })
    const second = Shared.stub().script()
    yield* brain.send(`first ${first.marker}`)
    yield* Effect.promise(() => first.called())
    yield* brain.models({ stub: Shared.apiKey("second", expires + 1000) })
    yield* brain.send(`second ${second.marker}`)
    first.release()
    yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
    expect([first.calls[0]?.authorization, second.calls[0]?.authorization]).toEqual(["Bearer first", "Bearer second"])
  }),
)

it.live("expired keys fail without a model call and a fresh configuration recovers", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    const expires = Date.now() - 1000
    yield* brain.start()
    yield* brain.models({ stub: Shared.apiKey("expired", expires) })
    const script = Shared.stub().script()
    yield* brain.send(`expired ${script.marker}`)
    const sessionID = SessionID.make(brain.id)
    yield* brain.opencode.session.wait({ sessionID })
    expect(script.calls).toEqual([])
    expect((yield* brain.opencode.message.list({ sessionID, order: "desc" })).data[0]).toMatchObject({
      type: "idle",
      outcome: "failed",
      error: { message: expect.stringContaining(`expired at ${new Date(expires).toISOString()}`) },
    })
    yield* brain.models({ stub: Shared.apiKey("fresh", Date.now() + 3_600_000) })
    const fresh = Shared.stub().script()
    yield* brain.send(`fresh ${fresh.marker}`)
    yield* brain.opencode.session.wait({ sessionID })
    expect(fresh.calls[0]?.authorization).toBe("Bearer fresh")
  }),
)
