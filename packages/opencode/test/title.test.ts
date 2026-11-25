import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { Model, Provider } from "@opencode/plugin/effect"
import { OpenCodeHost } from "@ren/cell/testing"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import { Effect, Queue, type Scope, Stream } from "effect"
import { Binding } from "../src/binding.js"
import { RenRpc } from "../src/rpc.js"
import { RenServer } from "./lib/ren.js"

const plugin = fileURLToPath(new URL("..", import.meta.url))
const model = { providerID: Provider.ID.make("ren"), id: Model.ID.make("stub/stub-model") }

process.env["REN_TOKEN"] = "user-token"

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => body.pipe(Effect.scoped, Effect.runPromise)

const setup = Effect.fnUntraced(function* () {
  const ren = yield* RenServer.make()
  ren.state.answer = (prompt) => {
    ren.state.delivered.add(prompt.id)
    ren.send(RenServer.frame("session.inbox.delivered", { sessionID: prompt.sessionID, inboxID: prompt.id }))
    const step = { sessionID: prompt.sessionID, assistantMessageID: SessionMessage.ID.create() }
    ren.send(RenServer.frame("session.text.started", { ...step, ordinal: 0 }))
    ren.send(RenServer.frame("session.text.ended", { ...step, ordinal: 0, text: "answer" }))
    ren.send(RenServer.frame("session.execution.succeeded", { sessionID: prompt.sessionID }))
  }
  const host = yield* OpenCodeHost.make({
    plugins: [{ package: plugin, options: { url: ren.url, space: ren.state.spaceId } }],
  })
  const titles = yield* Queue.unbounded<{ readonly sessionID: string; readonly title: string }>()
  const connected = yield* Queue.unbounded<void>()
  yield* host.client.event.subscribe({ types: ["session.renamed"] }).pipe(
    Stream.runForEach((event) =>
      event.type === "session.renamed" ? Queue.offer(titles, event.data) : Queue.offer(connected, undefined),
    ),
    Effect.forkScoped,
  )
  yield* Queue.take(connected)
  const renamed = (sessionID: string, title: string): Effect.Effect<void> =>
    Queue.take(titles).pipe(
      Effect.flatMap((next) =>
        next.sessionID === sessionID && next.title === title ? Effect.void : renamed(sessionID, title),
      ),
    )
  const local = (sessionID: string) => {
    const id = Binding.LocalID.make(sessionID)
    return {
      sessionID,
      prompt: (text: string) =>
        host.client.session.prompt({ sessionID: id, text }).pipe(
          Effect.orDie,
          Effect.tap(() => host.client.experimental.session.wait({ sessionID: id }).pipe(Effect.orDie)),
        ),
      rename: (title: string) => host.client.session.update({ sessionID: id, title }).pipe(Effect.orDie),
      title: host.client.session.get({ sessionID: id }).pipe(
        Effect.orDie,
        Effect.map((info) => info.title),
      ),
      renamed: (title: string) => renamed(sessionID, title),
    }
  }
  const open = Effect.gen(function* () {
    const session = yield* host.client.session.create({ location: host.location, model }).pipe(Effect.orDie)
    return local(session.id)
  })
  return { ren, host, titles, local, open }
})

test("a local rename of a Ren session reaches its brain once, and the brain's echo changes nothing locally", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const session = yield* opened.open
      yield* session.prompt("hello")
      yield* session.rename("Mine")
      expect(yield* Queue.take(opened.ren.renamed)).toBe("Mine")
      yield* session.rename("Second")
      expect(yield* Queue.take(opened.ren.renamed)).toBe("Second")
      opened.ren.send(RenServer.frame("session.renamed", { sessionID: session.sessionID, title: "Theirs" }))
      yield* session.renamed("Theirs")
      expect(opened.ren.state.renames).toEqual([
        { sessionID: session.sessionID, title: "Mine" },
        { sessionID: session.sessionID, title: "Second" },
      ])
      expect(yield* session.title).toBe("Theirs")
    }),
  ))

test("a rename on Ren updates the local title and is not sent back, and a subagent's rename is ignored", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const session = yield* opened.open
      yield* session.prompt("hello")
      opened.ren.send(RenServer.frame("session.renamed", { sessionID: Session.ID.create(), title: "A subagent" }))
      opened.ren.send(RenServer.frame("session.renamed", { sessionID: session.sessionID, title: "From the web" }))
      expect(yield* Queue.take(opened.titles)).toEqual({ sessionID: session.sessionID, title: "From the web" })
      yield* session.rename("Mine")
      expect(yield* Queue.take(opened.ren.renamed)).toBe("Mine")
      expect(opened.ren.state.renames).toEqual([{ sessionID: session.sessionID, title: "Mine" }])
    }),
  ))

test("a title that OpenCode's title hook takes from Ren, even shortened, is not sent back", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const session = yield* opened.open
      yield* session.prompt("hello")
      const long = `A title from Ren ${"that goes on ".repeat(10)}`.trim()
      opened.ren.state.titles.set(session.sessionID, long)
      yield* session.rename("")
      yield* session.renamed(`${long.slice(0, 97)}...`)
      yield* session.rename("Mine")
      expect(yield* Queue.take(opened.ren.renamed)).toBe("Mine")
      expect(opened.ren.state.renames).toEqual([{ sessionID: session.sessionID, title: "Mine" }])
    }),
  ))

test("a local session that is not a Ren session sends no rename, and a /ren:new session's title reaches Ren when its first prompt creates it", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const plain = yield* opened.host.client.session.create({ location: opened.host.location }).pipe(Effect.orDie)
      yield* opened.local(plain.id).rename("Local only")
      const created = yield* opened.host.client
        .rpc(RenRpc.Definition)
        .createSession({}, { location: opened.host.location })
      const session = opened.local(created.sessionID)
      yield* session.rename("Planned")
      yield* session.renamed("Planned")
      yield* session.prompt("hello")
      expect(yield* Queue.take(opened.ren.renamed)).toBe("Planned")
      expect(opened.ren.state.renames).toEqual([{ sessionID: created.sessionID, title: "Planned" }])
    }),
  ))

test("a rename while the brain does not answer keeps the local title and reaches Ren when the session connects again", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const session = yield* opened.open
      yield* session.prompt("hello")
      opened.ren.send(RenServer.frame("stream.ended", { reason: "idle" }))
      expect(yield* Queue.take(opened.ren.closed)).toBe(session.sessionID)
      opened.ren.state.refusing = true
      yield* session.rename("Offline")
      yield* Queue.take(opened.ren.refused)
      expect(yield* session.title).toBe("Offline")
      opened.ren.state.refusing = false
      yield* session.prompt("again")
      expect(yield* Queue.take(opened.ren.renamed)).toBe("Offline")
      expect(opened.ren.state.renames).toEqual([{ sessionID: session.sessionID, title: "Offline" }])
      expect(yield* session.title).toBe("Offline")
    }),
  ))
