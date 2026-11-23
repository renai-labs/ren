import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { Model, Provider } from "@opencode/plugin/effect"
import { OpenCodeHost } from "@ren/cell/testing"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import { Effect, Fiber, Queue, Stream } from "effect"
import { RenServer } from "./lib/ren.js"

const plugin = fileURLToPath(new URL("..", import.meta.url))
const model = { providerID: Provider.ID.make("ren"), id: Model.ID.make("stub/stub-model") }

process.env["REN_TOKEN"] = "user-token"

const setup = Effect.fnUntraced(function* () {
  const ren = yield* RenServer.make()
  const host = yield* OpenCodeHost.make({
    plugins: [{ package: plugin, options: { url: ren.url, space: ren.state.spaceId } }],
  })
  const session = yield* host.client.session.create({ location: host.location, model }).pipe(Effect.orDie)
  const prompt = (text: string) =>
    host.client.session.prompt({ sessionID: session.id, text }).pipe(
      Effect.orDie,
      Effect.tap(() => host.client.experimental.session.wait({ sessionID: session.id }).pipe(Effect.orDie)),
    )
  const messages = host.client.session.context({ sessionID: session.id }).pipe(Effect.orDie)
  return { ren, host, session, prompt, messages }
})

const run = <A, E>(body: Effect.Effect<A, E, import("effect").Scope.Scope>) =>
  body.pipe(Effect.scoped, Effect.runPromise)

const reply = (ren: Effect.Success<ReturnType<typeof setup>>["ren"], prompt: RenServer.Prompt, text: string) => {
  const step = { sessionID: prompt.sessionID, assistantMessageID: SessionMessage.ID.create() }
  ren.send(RenServer.frame("session.text.started", { ...step, ordinal: 0 }))
  ren.send(RenServer.frame("session.text.delta", { ...step, ordinal: 0, delta: text }))
  ren.send(RenServer.frame("session.text.ended", { ...step, ordinal: 0, text }))
  ren.send(RenServer.frame("session.tool.input.started", { ...step, id: "call_1", name: "read" }))
  ren.send(RenServer.frame("session.tool.called", { ...step, id: "call_1", input: { path: "a.ts" }, executed: false }))
  ren.send(
    RenServer.frame("session.tool.success", {
      ...step,
      id: "call_1",
      content: [{ type: "text", text: "export {}" }],
      executed: false,
    }),
  )
  ren.send(
    RenServer.frame("session.step.ended", {
      ...step,
      finish: "stop",
      cost: 0,
      tokens: { input: 10, output: 4, reasoning: 0, cache: { read: 0, write: 0 } },
    }),
  )
  ren.send(RenServer.frame("session.execution.succeeded", { sessionID: prompt.sessionID }))
}

const deliver = (ren: Effect.Success<ReturnType<typeof setup>>["ren"], prompt: RenServer.Prompt) => {
  ren.state.delivered.add(prompt.id)
  ren.send(RenServer.frame("session.inbox.delivered", { sessionID: prompt.sessionID, inboxID: prompt.id }))
}

const texts = (messages: ReadonlyArray<{ readonly type: string }>) =>
  messages.flatMap((message) =>
    "content" in message && Array.isArray(message.content)
      ? message.content.flatMap((part: { readonly type: string; readonly text?: string; readonly name?: string }) => {
          if (part.type === "tool") return [`tool:${part.name}`]
          return part.type === "text" ? [part.text] : []
        })
      : [],
  )

test("signed in, the plugin lists Ren's models as ren/<endpoint>/<model> with no local compaction", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const models = yield* opened.host.client.model.list({ location: opened.host.location }).pipe(Effect.orDie)
      expect(
        models.data
          .filter((each) => each.providerID === "ren")
          .map((each) => ({
            id: String(each.id),
            name: each.name,
            limit: each.limit,
            variants: each.variants.map((variant) => String(variant.id)),
          })),
      ).toEqual([{ id: "stub/stub-model", name: "Stub", limit: { context: 0, output: 0 }, variants: ["high"] }])
    }),
  ))

test("the first prompt creates the Ren session with the local session's ID, sends the local message with its ID, and streams only the turn it started", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      opened.ren.state.answer = (prompt) => {
        const earlier = { sessionID: prompt.sessionID, assistantMessageID: SessionMessage.ID.create() }
        opened.ren.send(RenServer.frame("session.text.started", { ...earlier, ordinal: 0 }))
        opened.ren.send(RenServer.frame("session.text.delta", { ...earlier, ordinal: 0, delta: "an earlier turn" }))
        opened.ren.send(RenServer.frame("session.execution.succeeded", { sessionID: prompt.sessionID }))
        deliver(opened.ren, prompt)
        reply(opened.ren, prompt, "the answer")
      }
      const sent = yield* opened.prompt("hello")
      expect(opened.ren.state.created).toEqual([
        {
          id: Session.ID.make(opened.session.id),
          spaceId: opened.ren.state.spaceId,
          model: { providerID: "stub", id: "stub-model" },
        },
      ])
      expect(opened.ren.state.prompts).toEqual([
        { sessionID: opened.session.id, id: sent.id, text: "hello", delivery: "steer" },
      ])
      const local = yield* opened.host.client.session.get({ sessionID: opened.session.id }).pipe(Effect.orDie)
      expect(local.metadata).toEqual({ ren: { spaceId: opened.ren.state.spaceId, sessionId: opened.session.id } })
      expect(texts(yield* opened.messages)).toEqual(["the answer", "tool:read"])
    }),
  ))

test("a local message that Ren already has is not sent again, and a turn the brain already ended finishes at once", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      opened.ren.state.answer = (prompt) => {
        deliver(opened.ren, prompt)
        opened.ren.send(
          RenServer.frame("session.execution.failed", {
            sessionID: prompt.sessionID,
            error: { type: "unknown", message: "the model failed" },
          }),
        )
      }
      const first = yield* opened.prompt("first")
      opened.ren.state.answer = (prompt) => {
        deliver(opened.ren, prompt)
        reply(opened.ren, prompt, "the second answer")
      }
      const second = yield* opened.prompt("second")
      expect(opened.ren.state.prompts.map((prompt) => prompt.id)).toEqual([first.id, second.id])
      expect(texts(yield* opened.messages)).toEqual(["the second answer", "tool:read"])
      opened.ren.state.answer = () => undefined
      yield* opened.host.client.session.synthetic({ sessionID: opened.session.id, text: "go on" }).pipe(Effect.orDie)
      yield* opened.host.client.experimental.session.wait({ sessionID: opened.session.id }).pipe(Effect.orDie)
      expect(opened.ren.state.prompts).toHaveLength(2)
    }),
  ))

test("after the event stream drops mid-turn the turn reads Ren's state again and goes on with the running execution", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      opened.ren.state.answer = (prompt) => {
        opened.ren.state.busy.add(prompt.sessionID)
        deliver(opened.ren, prompt)
        opened.ren.drop()
      }
      const sending = yield* opened.prompt("hello").pipe(Effect.forkChild)
      const prompt = yield* Queue.take(opened.ren.prompted)
      yield* Queue.take(opened.ren.opened)
      yield* Queue.take(opened.ren.opened)
      yield* Queue.take(opened.ren.checked)
      opened.ren.state.busy.delete(prompt.sessionID)
      reply(opened.ren, prompt, "after the reconnect")
      yield* Fiber.join(sending)
      expect(texts(yield* opened.messages)).toEqual(["after the reconnect", "tool:read"])
    }),
  ))

test("stopping the local turn interrupts the Ren session", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      opened.ren.state.answer = (prompt) => deliver(opened.ren, prompt)
      yield* opened.host.client.session.prompt({ sessionID: opened.session.id, text: "hello" }).pipe(Effect.orDie)
      yield* Queue.take(opened.ren.prompted)
      yield* opened.host.client.session.interrupt({ sessionID: opened.session.id }).pipe(Effect.orDie)
      expect(yield* Queue.take(opened.ren.interrupted)).toBe(opened.session.id)
    }),
  ))

test("the title of a Ren session is Ren's title, and OpenCode asks no model for one", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      opened.ren.state.answer = (prompt) => {
        deliver(opened.ren, prompt)
        reply(opened.ren, prompt, "answer")
      }
      const renamed = yield* opened.host.client.event
        .subscribe({ types: ["session.renamed"] })
        .pipe(Stream.runHead, Effect.forkChild)
      yield* opened.prompt("first")
      opened.ren.state.titles.set(opened.session.id, "Ren's title")
      yield* opened.prompt("second")
      yield* Fiber.join(renamed)
      const local = yield* opened.host.client.session.get({ sessionID: opened.session.id }).pipe(Effect.orDie)
      expect(local.title).toBe("Ren's title")
      expect(opened.ren.state.prompts.map((prompt) => prompt.text)).toEqual(["first", "second"])
    }),
  ))
