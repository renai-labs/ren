import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { Model, Provider } from "@opencode/plugin/effect"
import { OpenCodeHost } from "@ren/cell/testing"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import { DateTime, Effect, Queue, type Scope, Stream } from "effect"
import { Binding } from "../src/binding.js"
import { RenServer } from "./lib/ren.js"

const plugin = fileURLToPath(new URL("..", import.meta.url))
const ren = Provider.ID.make("ren")
const model = { providerID: ren, id: Model.ID.make("stub/stub-model") }

process.env["REN_TOKEN"] = "user-token"

const setup = Effect.fnUntraced(function* () {
  const server = yield* RenServer.make()
  const host = yield* OpenCodeHost.make({
    plugins: [{ package: plugin, options: { url: server.url, space: server.state.spaceId } }],
    providers: {
      local: {
        package: "@ai-sdk/openai-compatible",
        settings: { baseURL: `${server.url}/local/v1`, apiKey: "local-key" },
        models: { "local-model": { name: "Local", limit: { context: 100_000, output: 4000 } } },
      },
    },
  })
  const session = yield* host.client.session.create({ location: host.location, model }).pipe(Effect.orDie)
  server.state.answer = (prompt) => {
    server.state.delivered.add(prompt.id)
    const step = { sessionID: prompt.sessionID, assistantMessageID: SessionMessage.ID.create() }
    server.send(RenServer.frame("session.inbox.delivered", { sessionID: prompt.sessionID, inboxID: prompt.id }))
    server.send(RenServer.frame("session.text.started", { ...step, ordinal: 0 }))
    server.send(RenServer.frame("session.text.ended", { ...step, ordinal: 0, text: `re: ${prompt.text}` }))
    server.send(
      RenServer.frame("session.step.ended", {
        ...step,
        finish: "stop",
        cost: 0,
        tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      }),
    )
    server.send(RenServer.frame("session.execution.succeeded", { sessionID: prompt.sessionID }))
  }
  const wait = (sessionID: string) =>
    host.client.experimental.session.wait({ sessionID: Binding.LocalID.make(sessionID) }).pipe(Effect.orDie)
  const prompt = (sessionID: string, text: string) =>
    host.client.session.prompt({ sessionID: Binding.LocalID.make(sessionID), text }).pipe(
      Effect.orDie,
      Effect.tap(() => wait(sessionID)),
    )
  const messages = (sessionID: string) =>
    host.client.session.context({ sessionID: Binding.LocalID.make(sessionID) }).pipe(Effect.orDie)
  const errors = (sessionID: string) =>
    messages(sessionID).pipe(
      Effect.map((all) =>
        all.flatMap((message) => (message.type === "assistant" && message.error ? [message.error.message] : [])),
      ),
    )
  return { ren: server, host, session, wait, prompt, messages, errors }
})

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => body.pipe(Effect.scoped, Effect.runPromise)

test("a Ren model picked on a Ren session reaches the brain right before the next prompt, and only when the brain's model differs", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const id = Session.ID.create()
      yield* opened.host.client.session
        .create({
          location: opened.host.location,
          id: Binding.LocalID.make(id),
          model,
          metadata: { ren: { spaceId: opened.ren.state.spaceId, sessionId: id } },
        })
        .pipe(Effect.orDie)
      opened.ren.state.remoteModels.set(id, { providerID: "stub", id: "stub-model" })
      const seen: Array<readonly [string, number]> = []
      const answer = opened.ren.state.answer
      opened.ren.state.answer = (prompt) => {
        seen.push([prompt.text, opened.ren.state.switches.length])
        answer(prompt)
      }
      yield* opened.prompt(id, "same model")
      yield* opened.host.client.session
        .switchModel({
          sessionID: Binding.LocalID.make(id),
          model: { ...model, variant: Model.VariantID.make("high") },
        })
        .pipe(Effect.orDie)
      expect(opened.ren.state.switches).toEqual([])
      yield* opened.prompt(id, "picked variant")
      expect(opened.ren.state.switches).toEqual([
        { sessionID: id, model: { providerID: "stub", id: "stub-model", variant: "high" } },
      ])
      expect(seen).toEqual([
        ["same model", 0],
        ["picked variant", 1],
      ])
    }),
  ))

test("a model that the Ren session's space does not offer fails the turn with a message and sends nothing", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const beta = opened.ren.state.beta.id
      const session = yield* opened.host.client.session
        .create({ location: opened.host.location, model, metadata: { ren: { spaceId: beta } } })
        .pipe(Effect.orDie)
      yield* opened.prompt(session.id, "first")
      opened.ren.state.models.set(beta, RenServer.otherChoices)
      yield* opened.host.client.session
        .switchModel({ sessionID: session.id, model: { ...model, variant: Model.VariantID.make("high") } })
        .pipe(Effect.orDie)
      yield* opened.prompt(session.id, "second")
      expect(yield* opened.errors(session.id)).toEqual([
        "Ren could not switch this session to stub/stub-model (high): This space has no model stub/stub-model. Pick another ren model.",
      ])
      expect(opened.ren.state.prompts.map((prompt) => prompt.text)).toEqual(["first"])
    }),
  ))

test("a local model picked on a Ren session is switched back before the prompt runs, with a notice, and the local model is never called", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      yield* opened.prompt(opened.session.id, "first")
      yield* opened.host.client.session
        .switchModel({
          sessionID: opened.session.id,
          model: { providerID: Provider.ID.make("local"), id: Model.ID.make("local-model") },
        })
        .pipe(Effect.orDie)
      yield* opened.prompt(opened.session.id, "second")
      expect(opened.ren.state.local).toEqual([])
      expect(opened.ren.state.prompts.map((prompt) => prompt.text)).toEqual(["first", "second"])
      const local = yield* opened.host.client.session.get({ sessionID: opened.session.id }).pipe(Effect.orDie)
      expect(local.model).toMatchObject(model)
      const notices = (yield* opened.messages(opened.session.id)).flatMap((message) =>
        message.type === "synthetic" ? [message.description] : [],
      )
      expect(notices).toEqual([
        "A Ren session runs only on ren models, so it stays on ren/stub/stub-model. To continue on a local model, fork it.",
      ])
    }),
  ))

test("/compact on a Ren session compacts it on the brain, keeps the brain's summary as the local compaction, and the next prompt still reaches the brain", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      yield* opened.prompt(opened.session.id, "first")
      yield* opened.host.client.session.compact({ sessionID: opened.session.id }).pipe(Effect.orDie)
      yield* opened.wait(opened.session.id)
      yield* Queue.take(opened.ren.compacted)
      expect(
        (yield* opened.messages(opened.session.id)).flatMap((message) =>
          message.type === "compaction"
            ? [{ status: message.status, summary: "summary" in message && message.summary }]
            : [],
        ),
      ).toEqual([{ status: "completed", summary: "the summary" }])
      yield* opened.prompt(opened.session.id, "after")
      expect(opened.ren.state.prompts.map((prompt) => prompt.text)).toEqual(["first", "after"])
      expect(yield* opened.errors(opened.session.id)).toEqual([])
    }),
  ))

test("when the brain's event stream drops during a compaction, the compaction reads the brain's result", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      yield* opened.prompt(opened.session.id, "first")
      opened.ren.state.compact = (sessionID, id) => {
        opened.ren.send(
          RenServer.frame("session.compaction.started", { sessionID, reason: "manual", recent: "", inputID: id }),
        )
        opened.ren.state.compactions.set(id, {
          id,
          type: "compaction",
          status: "completed",
          reason: "manual",
          summary: "read after the drop",
          recent: "",
          time: { created: DateTime.nowUnsafe() },
        })
        opened.ren.drop()
      }
      yield* opened.host.client.session.compact({ sessionID: opened.session.id }).pipe(Effect.orDie)
      yield* opened.wait(opened.session.id)
      expect(
        (yield* opened.messages(opened.session.id)).flatMap((message) =>
          message.type === "compaction" && message.status === "completed" ? [message.summary] : [],
        ),
      ).toEqual(["read after the drop"])
    }),
  ))

test("a Ren session that cannot compact fails /compact with a message and the brain is not asked", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      yield* opened.prompt(opened.session.id, "first")
      opened.ren.state.compactable = false
      yield* opened.host.client.session.compact({ sessionID: opened.session.id }).pipe(Effect.orDie)
      yield* opened.wait(opened.session.id)
      expect(
        (yield* opened.messages(opened.session.id)).flatMap((message) =>
          message.type === "compaction" && message.status === "failed" ? [message.error.message] : [],
        ),
      ).toEqual(["This Ren session cannot be compacted."])
      expect(yield* Queue.size(opened.ren.compacted)).toBe(0)
    }),
  ))

test("archiving a local Ren session archives the Ren session, and deleting a local copy leaves it alone", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      yield* opened.prompt(opened.session.id, "first")
      const other = yield* opened.host.client.session
        .create({ location: opened.host.location, model })
        .pipe(Effect.orDie)
      yield* opened.prompt(other.id, "second")
      yield* opened.host.client.session.remove({ sessionID: other.id }).pipe(Effect.orDie)
      yield* opened.host.client.session.update({ sessionID: opened.session.id, archived: true }).pipe(Effect.orDie)
      expect(yield* Queue.take(opened.ren.archived)).toBe(opened.session.id)
      expect(yield* Queue.size(opened.ren.archived)).toBe(0)
    }),
  ))

test("a fork of a Ren session is disconnected from Ren, and its prompt is refused with what to do instead", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      yield* opened.prompt(opened.session.id, "first")
      const updated = yield* Queue.unbounded<string>()
      yield* opened.host.client.event.subscribe({ types: ["session.metadata.updated"] }).pipe(
        Stream.runForEach((event) =>
          Queue.offer(updated, event.type === "session.metadata.updated" ? event.data.sessionID : ""),
        ),
        Effect.forkScoped,
      )
      yield* Queue.take(updated)
      const fork = yield* opened.host.client.session.fork({ sessionID: opened.session.id }).pipe(Effect.orDie)
      expect(yield* Queue.take(updated)).toBe(fork.id)
      const forked = yield* opened.host.client.session.get({ sessionID: fork.id }).pipe(Effect.orDie)
      expect(forked.metadata).toEqual({})
      const original = yield* opened.host.client.session.get({ sessionID: opened.session.id }).pipe(Effect.orDie)
      expect(original.metadata).toEqual({ ren: { spaceId: opened.ren.state.spaceId, sessionId: opened.session.id } })
      yield* opened.prompt(fork.id, "in the fork")
      expect(yield* opened.errors(fork.id)).toEqual([
        "This session is a local copy of a Ren session, and Ren has no fork. Pick a local model to continue it here, or go back to the Ren session.",
      ])
      expect(opened.ren.state.created).toHaveLength(1)
      expect(opened.ren.state.prompts.map((prompt) => prompt.text)).toEqual(["first"])
    }),
  ))
