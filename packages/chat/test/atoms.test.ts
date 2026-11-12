import { expect, setDefaultTimeout, test } from "bun:test"
import { Shared } from "@ren/cell/testing"
import { BrainTest } from "@ren/cell/testing/brain"
import { SessionMessage } from "@ren/schema/session/message"
import { Shell } from "@ren/schema/shell"
import { readdirSync } from "node:fs"
import { DateTime, Effect, Layer, Option, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity"
import { ChatAtoms } from "../src/atoms.js"
import { ChatState } from "../src/chat-state.js"
import { TimelineRow } from "../src/timeline-row.js"

setDefaultTimeout(60_000)

const stub = Shared.stub()

type Fetch = (path: string, request: Request | RequestInit) => Promise<Response>

const setupWith = (intercept?: (path: string, next: () => Promise<Response>) => Promise<Response>) =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.make()
    yield* brain.start()
    const chatFetch: Fetch = (path, request) => Promise.resolve(brain.chatFetch(path, request))
    const http = FetchHttpClient.layer.pipe(
      Layer.provide(
        Layer.succeed(
          FetchHttpClient.Fetch,
          Object.assign(
            (input: string | URL | Request, init?: RequestInit) => {
              const url = new URL(input instanceof Request ? input.url : String(input))
              const path = `${url.pathname}${url.search}`
              const next = () => chatFetch(path, input instanceof Request ? input : (init ?? {}))
              return intercept ? intercept(path, next) : next()
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
          status: "ready" as const,
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

const setup = setupWith()

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

test("attention reports a session once something else opens it, and never opens it itself", () =>
  Effect.gen(function* () {
    const made = yield* setup
    const attention = made.atoms.attention
    const id = made.brain.id
    const reported = Effect.callback<string>((resume) => {
      const check = () => {
        const value = attention.read(id)
        if (value === undefined) return
        stop()
        resume(Effect.succeed(value))
      }
      const stop = attention.subscribe(check)
      check()
    })
    expect(attention.read(id)).toBeUndefined()
    expect(made.registry.getNodes().has(made.atoms.session(id))).toBe(false)
    const unmount = made.registry.mount(made.atoms.state(id))
    yield* Effect.addFinalizer(() => Effect.sync(unmount))
    expect(yield* reported).toBe("idle")
  }).pipe(Effect.scoped, Effect.runPromise))

test("a new chat's first prompt is in the timeline as soon as its session opens, before the session echoes it", () =>
  Effect.gen(function* () {
    const made = yield* setup
    const id = SessionMessage.ID.create()
    made.atoms.handoff(made.brain.id, { id, text: "Draft the quarterly report" })
    const state = made.atoms.state(made.brain.id)
    yield* Effect.addFinalizer(() => Effect.sync(made.registry.mount(state)))
    const opened = yield* made.until(state, AsyncResult.isSuccess)
    expect(
      AsyncResult.isSuccess(opened) &&
        ChatState.userMessages(opened.value, made.brain.id).map((message) => message.text),
    ).toEqual(["Draft the quarterly report"])
  }).pipe(Effect.scoped, Effect.runPromise))

test("the file atom searches the session only once the mention has a query", () =>
  Effect.gen(function* () {
    const made = yield* setup
    yield* Effect.promise(() => Bun.write(`${made.brain.directory}/launch-plan.md`, "# Plan"))
    const empty = made.atoms.files({ root: made.brain.id, query: "" })
    const typed = made.atoms.files({ root: made.brain.id, query: "launch", type: "file" })
    yield* Effect.addFinalizer(() => Effect.sync(made.registry.mount(empty)))
    yield* Effect.addFinalizer(() => Effect.sync(made.registry.mount(typed)))
    const none = yield* made.until(empty, AsyncResult.isSuccess)
    expect(AsyncResult.isSuccess(none) && none.value).toEqual([])
    const found = yield* made.until(typed, AsyncResult.isSuccess)
    expect(AsyncResult.isSuccess(found) && found.value).toEqual([{ path: "launch-plan.md", type: "file" }])
  }).pipe(Effect.scoped, Effect.runPromise))

const withFolders = Effect.gen(function* () {
  const folder = { directory: "" }
  const made = yield* setupWith((path, next) => {
    if (!path.includes("/file/list")) return next()
    const requested = new URL(path, "http://cell").searchParams.get("path") ?? ""
    const entries = readdirSync(`${folder.directory}/${requested}`, { withFileTypes: true }).map((entry) => ({
      path: `${requested}${entry.name}`,
      type: entry.isDirectory() ? "directory" : "file",
    }))
    return Promise.resolve(Response.json(entries))
  })
  folder.directory = made.brain.directory
  return made
})

test("fileExists confirms a file in a folder, and a bare name only when exactly one file has it", () =>
  Effect.gen(function* () {
    const made = yield* withFolders
    const root = made.brain.id
    yield* Effect.promise(() =>
      Promise.all([
        Bun.write(`${made.brain.directory}/README.md`, "# Readme"),
        Bun.write(`${made.brain.directory}/src/app.tsx`, "export {}"),
        Bun.write(`${made.brain.directory}/src/only.ts`, "export {}"),
        Bun.write(`${made.brain.directory}/src/twin.ts`, "export {}"),
        Bun.write(`${made.brain.directory}/lib/twin.ts`, "export {}"),
      ]),
    )
    const check = (path: string) =>
      Effect.gen(function* () {
        const atom = made.atoms.fileExists({ root, path })
        yield* Effect.addFinalizer(() => Effect.sync(made.registry.mount(atom)))
        const settled = yield* made.until(atom, AsyncResult.isSuccess)
        return AsyncResult.isSuccess(settled) ? settled.value : "pending"
      })
    expect(yield* check("README.md")).toBe("README.md")
    expect(yield* check("src/app.tsx")).toBe("src/app.tsx")
    expect(yield* check("src/missing.ts")).toBeUndefined()
    expect(yield* check("only.ts")).toBe("src/only.ts")
    expect(yield* check("twin.ts")).toBeUndefined()
    expect(yield* check("missing.ts")).toBeUndefined()
  }).pipe(Effect.scoped, Effect.runPromise))

test("fileExists finds a bare-name file that Ren creates after an earlier miss", () =>
  Effect.gen(function* () {
    const made = yield* withFolders
    const root = made.brain.id
    yield* Effect.addFinalizer(() => Effect.sync(made.registry.mount(made.atoms.state(root))))
    yield* made.until(made.atoms.status(root), (value) => AsyncResult.isSuccess(value) && value.value === "connected")
    const atom = made.atoms.fileExists({ root, path: "util.ts" })
    yield* Effect.addFinalizer(() => Effect.sync(made.registry.mount(atom)))
    const missed = yield* made.until(atom, AsyncResult.isSuccess)
    expect(AsyncResult.isSuccess(missed) && missed.value).toBeUndefined()
    yield* Effect.promise(() => Bun.write(`${made.brain.directory}/src/util.ts`, "export {}"))
    yield* Effect.sleep("11 seconds")
    yield* made.atoms.run(made.registry, root, (opened) =>
      opened.prompt({ text: stub.script({ reply: "done" }).marker }),
    )
    const found = yield* made.until(atom, (value) => AsyncResult.isSuccess(value) && value.value !== undefined)
    expect(AsyncResult.isSuccess(found) && found.value).toBe("src/util.ts")
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
    yield* brain.driver.shell(brain.id, "printf 'hello world'")
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

test("the models atom loads again once the connection is back when its first read failed", () =>
  Effect.gen(function* () {
    const streams: Array<ReadableStreamDefaultController<Uint8Array>> = []
    const network = { isDown: true }
    const made = yield* setupWith(async (path, next) => {
      if (path.startsWith("/chat/model") && network.isDown)
        return new Response("The brain is restarting", { status: 503 })
      const response = await next()
      const body = response.body
      if (!path.startsWith("/chat/event") || !body) return response
      const reader = body.getReader()
      return new Response(
        new ReadableStream<Uint8Array>({
          start: (controller) => {
            streams.push(controller)
          },
          pull: (controller) =>
            reader.read().then((chunk) => (chunk.done ? controller.close() : controller.enqueue(chunk.value))),
          cancel: () => reader.cancel(),
        }),
        { status: response.status, headers: response.headers },
      )
    })
    const id = made.brain.id
    const unmount = made.registry.mount(made.atoms.status(id))
    yield* Effect.addFinalizer(() => Effect.sync(unmount))
    const unmountModels = made.registry.mount(made.atoms.models(id))
    yield* Effect.addFinalizer(() => Effect.sync(unmountModels))
    yield* made.until(made.atoms.status(id), (value) => AsyncResult.isSuccess(value) && value.value === "connected")
    yield* made.until(made.atoms.models(id), AsyncResult.isFailure)
    network.isDown = false
    streams.at(-1)?.error(new Error("The network dropped"))
    yield* made.until(made.atoms.status(id), (value) => AsyncResult.isSuccess(value) && value.value === "reconnecting")
    const models = yield* made.until(made.atoms.models(id), AsyncResult.isSuccess)
    expect(AsyncResult.isSuccess(models) && models.value.length).toBeGreaterThan(0)
  }).pipe(Effect.scoped, Effect.runPromise))
