import { afterAll, expect, setDefaultTimeout, test } from "bun:test"
import { fileURLToPath } from "node:url"
import type { DialogSelectOptions } from "@opencode/plugin/tui/context"
import { OpenCodeHost, Shared } from "@ren/cell/testing"
import { BrainTest } from "@ren/cell/testing/brain"
import { Session } from "@ren/schema/session"
import { Effect, Fiber, Queue, type Scope, Stream } from "effect"
import { Binding } from "../src/binding.js"
import { RenCommands } from "../src/commands.js"
import { RenRpc } from "../src/rpc.js"
import { RenServer } from "./lib/ren.js"

setDefaultTimeout(60_000)

afterAll(Shared.dispose)

process.env["REN_TOKEN"] = "user-token"

const plugin = fileURLToPath(new URL("..", import.meta.url))

type Brain = Effect.Success<ReturnType<typeof BrainTest.make>>

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => body.pipe(Effect.scoped, Effect.runPromise)

const setup = Effect.fnUntraced(function* () {
  const target: { brain?: Brain; member?: { readonly sub: string; readonly name: string } } = {}
  const ren = yield* RenServer.make({
    chat: (path, request) =>
      target.brain
        ? target.brain.chatFetch(path, request, target.member)
        : Promise.resolve(new Response(null, { status: 503 })),
    created: () => (target.brain ? Effect.runPromise(target.brain.start().pipe(Effect.asVoid)) : Promise.resolve()),
  })
  target.member = { sub: ren.state.me.id, name: ren.state.me.name }
  const host = yield* OpenCodeHost.make({ plugins: [{ package: plugin, options: { url: ren.url } }] })
  const asked = yield* Queue.unbounded<string>()
  const connected = yield* Queue.unbounded<void>()
  yield* host.client.event.subscribe({ types: ["permission.asked", "form.created"] }).pipe(
    Stream.runForEach((event) =>
      event.type === "server.connected" ? Queue.offer(connected, undefined) : Queue.offer(asked, event.type),
    ),
    Effect.forkScoped,
  )
  yield* Queue.take(connected)
  const created = yield* host.client.rpc(RenRpc.Definition).createSession({}, { location: host.location })
  const brain = yield* BrainTest.make({ id: Session.ID.make(created.sessionID) })
  target.brain = brain
  const sessionID = Binding.LocalID.make(created.sessionID)
  const prompt = (text: string) =>
    host.client.session.prompt({ sessionID, text }).pipe(
      Effect.orDie,
      Effect.tap(() => host.client.experimental.session.wait({ sessionID }).pipe(Effect.orDie)),
    )
  const transcript = host.client.session.context({ sessionID }).pipe(
    Effect.orDie,
    Effect.map((messages) =>
      messages.flatMap((message) => {
        if (message.type === "user") return [`user:${message.text}`]
        if (message.type !== "assistant") return []
        return [message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")]
      }),
    ),
  )
  yield* prompt(Shared.stub().script({ reply: "Hello, Ada." }).marker)
  return { ren, host, brain, sessionID, asked, prompt, transcript }
})

test("on a real brain, a permission request of the remote turn shows as a local permission request, and the rejection with a message given locally lets the remote turn go on and finish in the local session", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      yield* opened.brain.opencode.session
        .update({ sessionID: opened.sessionID, permissions: [{ action: "webfetch", resource: "*", effect: "ask" }] })
        .pipe(Effect.orDie)
      const fetched = Shared.stub().script({
        tool: { name: "webfetch", input: { url: "https://example.com" } },
        reply: "I used the cached copy.",
      })
      const turn = yield* opened.prompt(fetched.marker).pipe(Effect.forkChild)
      expect(yield* Queue.take(opened.asked)).toBe("permission.asked")
      const local = yield* opened.host.client.permission.list({ sessionID: opened.sessionID }).pipe(Effect.orDie)
      expect(local).toMatchObject([
        { sessionID: opened.sessionID, action: "webfetch", resources: ["https://example.com"] },
      ])
      yield* Effect.forEach(local, (request) =>
        opened.host.client.permission
          .reply({
            sessionID: opened.sessionID,
            requestID: request.id,
            decision: "reject",
            message: "Read the cached copy instead",
          })
          .pipe(Effect.orDie),
      )
      yield* Fiber.join(turn)
      expect(JSON.stringify((yield* Effect.promise(() => fetched.called(2))).body)).toContain(
        "Read the cached copy instead",
      )
      expect((yield* opened.transcript).slice(-2)).toEqual([`user:${fetched.marker}`, "I used the cached copy."])
    }),
  ))

test("on a real brain, a question of the remote turn shows as OpenCode's own form through the TUI part, and the local answer lets the remote turn finish in the local session", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const live = Promise.withResolvers<void>()
      const listening = new AbortController()
      yield* Effect.addFinalizer(() => Effect.sync(() => listening.abort()))
      void (async () => {
        for await (const event of opened.host.promise.event.subscribe({ signal: listening.signal }))
          if (event.type === "server.connected") live.resolve()
      })().catch(() => undefined)
      yield* Effect.promise(() => live.promise)
      const stop = yield* Effect.promise(() =>
        RenCommands.requests({
          client: opened.host.promise,
          location: () => opened.host.location,
          ui: {
            dialog: {
              select: <Value>(_dialog: DialogSelectOptions<Value>) => Promise.resolve(undefined),
              confirm: () => Promise.resolve(false),
            },
            toast: { show: () => undefined },
            router: { navigate: () => undefined, current: () => ({ type: "home" }) },
            model: { current: () => undefined },
          },
        }),
      )
      yield* Effect.addFinalizer(() => Effect.sync(stop))
      const asking = Shared.stub().script({
        tool: {
          name: "question",
          input: {
            questions: [
              {
                question: "Which?",
                header: "Pick",
                options: [
                  { label: "A", description: "a" },
                  { label: "B", description: "b" },
                ],
              },
            ],
          },
        },
        reply: "You picked A.",
      })
      const turn = yield* opened.prompt(asking.marker).pipe(Effect.forkChild)
      expect(yield* Queue.take(opened.asked)).toBe("form.created")
      const [form] = yield* opened.host.client.session.form.list({ sessionID: opened.sessionID }).pipe(Effect.orDie)
      const field = form?.fields[0]
      expect(form).toMatchObject({ metadata: { ren: { kind: "question" } } })
      if (!form || !field) return
      yield* opened.host.client.session.form
        .reply({ sessionID: opened.sessionID, formID: form.id, answer: { [field.key]: "A" } })
        .pipe(Effect.orDie)
      yield* Fiber.join(turn)
      expect(JSON.stringify((yield* Effect.promise(() => asking.called(2))).body)).toContain("A")
      expect((yield* opened.transcript).slice(-2)).toEqual([`user:${asking.marker}`, "You picked A."])
    }),
  ))
