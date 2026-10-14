import { expect } from "bun:test"
import { SessionID } from "@opencode/schema/session-id"
import { BrainRejectedError, ForbiddenError, SessionNotStartedError } from "@ren/brain-api/errors"
import { Session } from "@ren/schema/session"
import { Deferred, Effect, Fiber } from "effect"
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
        model: { providerId: "stub", modelId: "stub-model" },
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
    const input = {
      instructions: { team: "Ren initial instructions" },
      credentials: { stub: { type: "key", key: "initial-key" } },
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
        model: { providerId: "stub", modelId: "stub-other" },
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

it.live("unknown agents, models and providers are typed rejections and create no session", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    const inputs: ReadonlyArray<Partial<Session.StartInput>> = [
      { agent: "nobody" },
      { model: { providerId: "stub", modelId: "missing" } },
      { credentials: { nobody: { type: "key", key: "secret" } } },
    ]
    for (const input of inputs) expect(yield* brain.start(input).pipe(Effect.flip)).toBeInstanceOf(BrainRejectedError)
    expect((yield* brain.opencode.session.list()).data).toEqual([])
    expect(yield* brain.credentials.all()).toEqual([])
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

it.live("start replaces credentials, send merges them, and an older managed key never replaces a newer one", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    const expires = Date.now() + 3_600_000
    yield* brain.start({
      credentials: { stub: { type: "managed", key: "old", expires }, anthropic: { type: "key", key: "anthropic" } },
    })
    const script = Shared.stub().script()
    yield* brain.send(`key ${script.marker}`, {
      credentials: { stub: { type: "managed", key: "new", expires: expires + 1000 } },
    })
    const sessionID = SessionID.make(brain.id)
    yield* brain.opencode.session.wait({ sessionID })
    expect(script.calls[0]?.authorization).toBe("Bearer new")
    expect(yield* brain.credentials.all()).toHaveLength(2)
    yield* brain.start({ credentials: { stub: { type: "managed", key: "old", expires } } })
    expect((yield* brain.credentials.all()).map((credential) => credential.value)).toMatchObject([
      { type: "oauth", access: "new" },
    ])
    yield* brain.start({ credentials: { stub: { type: "key", key: "replacement" } } })
    expect((yield* brain.credentials.all()).map((credential) => credential.value)).toEqual([
      { type: "key", key: "replacement" },
    ])
    yield* brain.start()
    expect(yield* brain.credentials.all()).toEqual([])
  }),
)

it.live("rejected starts restore the previous credential set", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    yield* brain.start({
      credentials: { stub: { type: "key", key: "kept" }, anthropic: { type: "key", key: "also-kept" } },
    })
    const previous = (yield* brain.credentials.all()).map((credential) => [credential.integrationID, credential.value])
    yield* brain.start({ agent: "nobody", credentials: { stub: { type: "key", key: "discard" } } }).pipe(Effect.flip)
    yield* brain.start({ model: { providerId: "stub", modelId: "missing" }, credentials: {} }).pipe(Effect.flip)
    expect((yield* brain.credentials.all()).map((credential) => [credential.integrationID, credential.value])).toEqual(
      previous,
    )
  }),
)

it.live("a managed key sent during a turn reaches its next model call", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    const expires = Date.now() + 3_600_000
    yield* brain.start({ credentials: { stub: { type: "managed", key: "first", expires } } })
    const first = Shared.stub().script({ hold: true })
    const second = Shared.stub().script()
    yield* brain.send(`first ${first.marker}`)
    yield* Effect.promise(() => first.called())
    yield* brain.send(`second ${second.marker}`, {
      credentials: { stub: { type: "managed", key: "second", expires: expires + 1000 } },
    })
    first.release()
    yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
    expect([first.calls[0]?.authorization, second.calls[0]?.authorization]).toEqual(["Bearer first", "Bearer second"])
  }),
)

it.live("a rejected start cannot roll back a concurrent send's newer credential", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    const expires = Date.now() + 3_600_000
    yield* brain.start({ credentials: { stub: { type: "managed", key: "old", expires } } })
    const script = Shared.stub().script()
    const validating = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const sending = yield* Deferred.make<void>()
    brain.transport.sending = Deferred.succeed(sending, undefined).pipe(Effect.asVoid)
    brain.transport.before = (request) =>
      new URL(request.url).pathname === "/api/agent"
        ? Deferred.succeed(validating, undefined).pipe(Effect.andThen(Deferred.await(release)))
        : Effect.void
    const rejected = yield* Effect.forkChild(
      brain
        .start({
          agent: "nobody",
          credentials: { stub: { type: "managed", key: "rejected", expires: expires + 1000 } },
        })
        .pipe(Effect.flip),
    )
    yield* Deferred.await(validating)
    brain.requests.length = 0
    const sent = yield* Effect.forkChild(
      brain.send(`new ${script.marker}`, {
        credentials: { stub: { type: "managed", key: "new", expires: expires + 2000 } },
      }),
    )
    yield* Deferred.await(sending)
    yield* Effect.yieldNow
    const whileValidating = [...brain.requests]
    yield* Deferred.succeed(release, undefined)
    expect(yield* Fiber.join(rejected)).toBeInstanceOf(BrainRejectedError)
    yield* Fiber.join(sent)
    expect(whileValidating).toEqual([])
    yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
    expect((yield* brain.credentials.all()).map((credential) => credential.value)).toMatchObject([
      { access: "new", expires: expires + 2000 },
    ])
    expect(script.calls[0]?.authorization).toBe("Bearer new")
  }),
)

it.live("a key's configuration reaches the provider's endpoint", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    yield* brain.start({
      credentials: {
        stub: {
          type: "key",
          key: "configured",
          configuration: { baseURL: Shared.stub().url.replace(/\/v1$/, "/configured/v1") },
        },
      },
    })
    const script = Shared.stub().script()
    yield* brain.send(`configured ${script.marker}`)
    yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
    expect(script.calls.map((call) => [call.path, call.authorization])).toEqual([
      ["/configured/v1/chat/completions", "Bearer configured"],
    ])
  }),
)

it.live("expired managed credentials fail without a model call and a fresh send recovers", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    const expires = Date.now() - 1000
    yield* brain.start({ credentials: { stub: { type: "managed", key: "expired", expires } } })
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
    const fresh = Shared.stub().script()
    yield* brain.send(`fresh ${fresh.marker}`, {
      credentials: { stub: { type: "managed", key: "fresh", expires: Date.now() + 3_600_000 } },
    })
    yield* brain.opencode.session.wait({ sessionID })
    expect(fresh.calls[0]?.authorization).toBe("Bearer fresh")
  }),
)
