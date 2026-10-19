import { expect, setDefaultTimeout, test } from "bun:test"
import { SessionID } from "@opencode/schema/session-id"
import { Shared } from "@ren/cell/testing"
import { BrainTest } from "@ren/cell/testing/brain"
import { Shell } from "@ren/schema/shell"
import { DateTime, Effect, Layer, Option, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity"
import { ChatAtoms } from "../src/atoms.js"
import { ChatState } from "../src/chat-state.js"
import { TimelineRow } from "../src/timeline-row.js"

setDefaultTimeout(60_000)

const stub = Shared.stub()

const setup = Effect.gen(function* () {
  const brain = yield* BrainTest.make()
  yield* brain.start()
  const http = FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(
        FetchHttpClient.Fetch,
        Object.assign(
          (input: string | URL | Request, init?: RequestInit) => {
            const url = new URL(input instanceof Request ? input.url : String(input))
            return brain.chatFetch(`${url.pathname}${url.search}`, input instanceof Request ? input : (init ?? {}))
          },
          { preconnect: fetch.preconnect },
        ),
      ),
    ),
  )
  const atoms = ChatAtoms.make({
    runtime: Atom.runtime(http),
    access: () =>
      Effect.sync(() => ({
        url: "http://cell",
        token: "a-client-token",
        expiresAt: DateTime.makeUnsafe(Date.now() + 3_600_000),
      })),
  })
  const registry = AtomRegistry.make()
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
  const until = <A>(atom: Atom.Atom<A>, predicate: (value: A) => boolean) =>
    AtomRegistry.toStream(registry, atom).pipe(
      Stream.filter(predicate),
      Stream.runHead,
      Effect.map(Option.getOrThrow),
      Effect.timeoutOrElse({
        duration: "20 seconds",
        orElse: () => Effect.die(new Error("The atom never reached the expected value")),
      }),
    )
  return { brain, atoms, registry, until }
})

test("the timeline atom of a session shows a prompt and its reply as rows", () =>
  Effect.gen(function* () {
    const made = yield* setup
    const brain = made.brain
    const timeline = made.atoms.timeline(brain.id)
    yield* Effect.addFinalizer(() => Effect.sync(made.registry.mount(timeline)))
    yield* made.until(
      made.atoms.status(brain.id),
      (value) => AsyncResult.isSuccess(value) && value.value === "connected",
    )
    yield* made.atoms.run(made.registry, brain.id, (opened) =>
      opened.prompt({ text: stub.script({ reply: "rows for the UI" }).marker }),
    )
    const rows = yield* made.until(
      timeline,
      (value) =>
        AsyncResult.isSuccess(value) &&
        value.value.rows.some((row) => row._tag === "AssistantPart") &&
        !value.value.rows.some((row) => row._tag === "Thinking"),
    )
    expect(AsyncResult.isSuccess(rows) && rows.value.rows.map(TimelineRow.key)).toEqual([
      expect.stringMatching(/^user-message:/),
      expect.stringMatching(/^assistant-part:part:/),
    ])
  }).pipe(Effect.scoped, Effect.runPromise))

test("the child atom of a subagent session reads its transcript through the root session", () =>
  Effect.gen(function* () {
    const made = yield* setup
    const brain = made.brain
    yield* Effect.addFinalizer(() => Effect.sync(made.registry.mount(made.atoms.timeline(brain.id))))
    yield* made.until(
      made.atoms.status(brain.id),
      (value) => AsyncResult.isSuccess(value) && value.value === "connected",
    )
    const child = stub.script({ reply: "child rows" })
    yield* made.atoms.run(made.registry, brain.id, (opened) =>
      opened.prompt({
        text: stub.script({
          tool: { name: "subagent", input: { agent: "general", description: "Look", prompt: child.marker } },
        }).marker,
      }),
    )
    const spawned = yield* made.until(
      made.atoms.state(brain.id),
      (value) =>
        AsyncResult.isSuccess(value) && Object.values(value.value.info).some((info) => info.parentID === brain.id),
    )
    const childID = AsyncResult.isSuccess(spawned)
      ? Object.values(spawned.value.info).find((info) => info.parentID === brain.id)?.id
      : undefined
    if (!childID) return yield* Effect.die(new Error("No subagent session"))
    const view = made.atoms.child({ root: brain.id, sessionID: childID })
    yield* Effect.addFinalizer(() => Effect.sync(made.registry.mount(view)))
    const rows = yield* made.until(
      view,
      (value) => AsyncResult.isSuccess(value) && value.value.rows.some((row) => row._tag === "AssistantPart"),
    )
    expect(AsyncResult.isSuccess(rows) && rows.value.rows.map((row) => row._tag)).toContain("UserMessage")
  }).pipe(Effect.scoped, Effect.runPromise))

test("the shell output atom reads a shell's output through the root session", () =>
  Effect.gen(function* () {
    const made = yield* setup
    const brain = made.brain
    yield* Effect.addFinalizer(() => Effect.sync(made.registry.mount(made.atoms.state(brain.id))))
    yield* made.until(
      made.atoms.status(brain.id),
      (value) => AsyncResult.isSuccess(value) && value.value === "connected",
    )
    yield* brain.opencode.session.shell({ sessionID: SessionID.make(brain.id), command: "printf 'hello world'" })
    const state = yield* made.until(
      made.atoms.state(brain.id),
      (value) =>
        AsyncResult.isSuccess(value) &&
        ChatState.messages(value.value, brain.id).some(
          (message) => message.type === "shell" && message.status !== "running",
        ),
    )
    const ran = AsyncResult.isSuccess(state)
      ? ChatState.messages(state.value, brain.id).find((message) => message.type === "shell")
      : undefined
    if (ran?.type !== "shell") return yield* Effect.die(new Error("No shell message"))
    const output = made.atoms.shellOutput({
      root: brain.id,
      sessionID: brain.id,
      shellID: Shell.ID.make(ran.shellID),
      running: false,
    })
    yield* Effect.addFinalizer(() => Effect.sync(made.registry.mount(output)))
    const read = yield* made.until(output, AsyncResult.isSuccess)
    expect(AsyncResult.isSuccess(read) && read.value).toBe("hello world")
  }).pipe(Effect.scoped, Effect.runPromise))
