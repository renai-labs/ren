import { expect, setDefaultTimeout, test } from "bun:test"
import { Agent } from "@opencode/schema/agent"
import { Form } from "@opencode/schema/form"
import { Permission } from "@opencode/schema/permission"
import { SessionID } from "@opencode/schema/session-id"
import { SessionMessage } from "@opencode/schema/session-message"
import { Shell } from "@opencode/schema/shell"
import { Session } from "@ren/schema/session"
import { SessionEvent } from "@ren/schema/session/event"
import { Effect, Option, Queue, Schema, Stream } from "effect"
import { OpenCodeEvents } from "../src/harness/opencode/events.js"
import { Translate } from "../src/harness/opencode/translate.js"
import { BrainTest } from "./lib/brain.js"
import { Shared } from "./lib/shared.js"

setDefaultTimeout(60_000)

const stub = Shared.stub()

const Typed = Schema.Struct({ type: Schema.String, data: Schema.Unknown })
const typed = Schema.decodeUnknownSync(Typed)

const FormCreated = Schema.Struct({
  data: Schema.Struct({
    form: Schema.Struct({
      id: Schema.String,
      fields: Schema.NonEmptyArray(
        Schema.Struct({ key: Schema.String, options: Schema.Array(Schema.Struct({ value: Schema.String })) }),
      ),
    }),
  }),
})

const ShellCreated = Schema.Struct({ data: Schema.Struct({ info: Schema.Struct({ id: Schema.String }) }) })

const PermissionAsked = Schema.Struct({ data: Schema.Struct({ id: Schema.String }) })

const question = {
  name: "question",
  input: { questions: [{ question: "Which?", header: "Pick", options: [{ label: "A", description: "a" }] }] },
}

const unreachable = new Set([
  "session.deleted",
  "session.compaction.failed",
  "session.skill.activated",
  "session.synthetic",
  "session.tool.input.delta",
])

test("every allowlisted event, message, inbox item, permission and form OpenCode produces in a session decodes with Ren's schemas", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.make()
    yield* brain.start({ interactive: true })
    const sessionID = SessionID.make(brain.id)
    const seen: Array<unknown> = []
    const queue = yield* Queue.unbounded<unknown>()
    yield* OpenCodeEvents.stream(brain.harness).pipe(
      Stream.runForEach((event) => Effect.sync(() => seen.push(event)).pipe(Effect.andThen(Queue.offer(queue, event)))),
      Effect.forkScoped,
    )
    const until = (type: string): Effect.Effect<unknown> =>
      Queue.take(queue).pipe(
        Effect.flatMap((event) => (typed(event).type === type ? Effect.succeed(event) : until(type))),
      )
    yield* until("server.connected")
    const reads: Array<{ readonly name: string; readonly item: unknown; readonly ok: boolean }> = []
    const read = <A>(name: string, items: ReadonlyArray<A>, translate: (item: A) => Option.Option<unknown>) => {
      reads.push(...items.map((item) => ({ name, item, ok: Option.isSome(translate(item)) })))
      return items
    }
    const turn = Effect.fnUntraced(function* (script: { readonly marker: string }, text = "") {
      yield* brain.send(`${text} ${script.marker}`)
      yield* brain.opencode.session.wait({ sessionID })
    })

    expect(read("agent", (yield* brain.opencode.agent.list()).data, Translate.agent)).not.toHaveLength(0)
    expect(read("skill", (yield* brain.opencode.skill.list()).data, Translate.skill)).not.toHaveLength(0)
    expect(read("command", (yield* brain.opencode.command.list()).data, Translate.command)).not.toHaveLength(0)
    expect(read("file", (yield* brain.opencode.file.find({ query: "package" })).data, Translate.file)).not.toHaveLength(
      0,
    )

    yield* turn(stub.script({ reasoning: "thinking it over", reply: "a plain answer" }))
    yield* turn(stub.script({ tool: { name: "skill", input: { name: "missing" } } }))
    yield* turn(stub.script({ status: 400 }))
    const child = stub.script()
    yield* turn(
      stub.script({
        tool: { name: "subagent", input: { agent: "general", description: "look around", prompt: child.marker } },
      }),
    )

    yield* brain.opencode.session.update({
      sessionID,
      permissions: [{ action: "webfetch", resource: "*", effect: "ask" }],
    })
    yield* brain.send(stub.script({ tool: { name: "webfetch", input: { url: "https://example.com" } } }).marker)
    const asked = Schema.decodeUnknownSync(PermissionAsked)(yield* until("permission.asked"))
    expect(read("permission", yield* brain.opencode.permission.list({ sessionID }), Translate.permission)).toHaveLength(
      1,
    )
    yield* brain.opencode.permission.reply({
      sessionID,
      requestID: Permission.ID.make(asked.data.id),
      decision: "reject",
    })
    yield* until("permission.replied")
    yield* brain.opencode.session.wait({ sessionID })
    yield* brain.opencode.session.update({ sessionID, permissions: [] })

    yield* brain.send(stub.script({ tool: question }).marker)
    const form = Schema.decodeUnknownSync(FormCreated)(yield* until("form.created")).data.form
    expect(read("form", yield* brain.opencode.session.form.list({ sessionID }), Translate.form)).toHaveLength(1)
    yield* brain.opencode.session.form.reply({
      sessionID,
      formID: Form.ID.make(form.id),
      answer: { [form.fields[0].key]: form.fields[0].options[0]?.value ?? "A" },
    })
    yield* brain.opencode.session.wait({ sessionID })
    yield* brain.send(stub.script({ tool: question }).marker)
    const dismissed = Schema.decodeUnknownSync(FormCreated)(yield* until("form.created")).data.form
    yield* brain.opencode.session.form.cancel({ sessionID, formID: Form.ID.make(dismissed.id) })
    yield* brain.opencode.session.wait({ sessionID })

    const retry = stub.script({ status: 503 })
    yield* brain.send(retry.marker)
    yield* Effect.promise(() => retry.called())
    retry.set({})
    yield* brain.opencode.session.wait({ sessionID })

    yield* brain.start({ interactive: true, model: { endpointId: "stub", modelId: "stub-other" } })

    const held = stub.script({ hold: true })
    yield* brain.send(held.marker)
    yield* Effect.promise(() => held.called())
    const cancelled = SessionMessage.ID.create()
    const changed = SessionMessage.ID.create()
    yield* brain.send(stub.script().marker, { delivery: "queue", messageId: Session.MessageID.make(cancelled) })
    yield* brain.send(stub.script().marker, { delivery: "queue", messageId: Session.MessageID.make(changed) })
    expect(read("inbox", yield* brain.opencode.session.inbox.list({ sessionID }), Translate.inbox)).toHaveLength(2)
    yield* brain.opencode.session.inbox.cancel({ sessionID, inboxID: cancelled })
    yield* brain.opencode.session.inbox.update({ sessionID, inboxID: changed, delivery: "steer" })
    yield* brain.opencode.session.synthetic({ sessionID, text: "a note", description: "note" })
    held.release()
    yield* brain.opencode.session.wait({ sessionID })

    const stopped = stub.script({ hold: true })
    yield* brain.send(stopped.marker)
    yield* Effect.promise(() => stopped.called())
    yield* brain.opencode.session.interrupt({ sessionID })
    stopped.release()
    yield* brain.opencode.session.wait({ sessionID })

    yield* brain.opencode.session.shell({ sessionID, command: "echo shell" })
    yield* brain.opencode.session.wait({ sessionID })
    const shell = Schema.decodeUnknownSync(ShellCreated)(yield* until("shell.created")).data.info
    yield* until("shell.exited")
    const location = { directory: (yield* brain.opencode.session.get({ sessionID })).location.directory }
    yield* brain.opencode.shell.remove({ id: Shell.ID.make(shell.id), location })
    yield* until("shell.deleted")

    yield* brain.opencode.session.update({ sessionID, title: "Renamed" })
    const summarized = { summary: "## Objective\n- the summary" }
    yield* turn(stub.script(summarized))
    yield* turn(stub.script(summarized))
    yield* brain.opencode.session.compact({ sessionID })
    yield* until("session.compaction.ended")
    yield* brain.opencode.session.wait({ sessionID })

    const messages = (yield* brain.opencode.message.list({ sessionID, order: "asc", limit: 200 })).data
    const user = messages.findLast((info) => info.type === "user")
    if (!user) return yield* Effect.die(new Error("The session has no user message"))
    yield* brain.opencode.session.revert.stage({ sessionID, messageID: user.id })
    yield* until("session.revert.staged")
    yield* brain.opencode.session.revert.clear({ sessionID })
    yield* until("session.revert.cleared")
    yield* turn(stub.script())
    yield* brain.opencode.session.revert.stage({ sessionID, messageID: user.id })
    yield* brain.opencode.session.revert.commit({ sessionID })
    yield* until("session.revert.committed")
    yield* brain.opencode.session.switchAgent({ sessionID, agent: Agent.ID.make("plan") })
    yield* until("session.agent.selected")

    const allowed = seen.filter(Translate.isAllowed)
    expect(allowed.filter((raw) => Option.isNone(Translate.event(raw))).map((raw) => typed(raw))).toEqual([])
    expect(
      [...SessionEvent.types].filter(
        (type) => !unreachable.has(type) && !allowed.some((raw) => typed(raw).type === type),
      ),
    ).toEqual([])
    const after = (yield* brain.opencode.message.list({ sessionID, order: "asc", limit: 200 })).data
    expect([...messages, ...after].filter((info) => Option.isNone(Translate.message(info)))).toEqual([])
    expect(
      new Set(
        [...messages, ...after].flatMap((info) => Option.toArray(Translate.message(info)).map((each) => each.type)),
      ),
    ).toEqual(
      new Set(["user", "synthetic", "assistant", "idle", "model-switched", "agent-switched", "shell", "compaction"]),
    )
    expect(reads.filter((entry) => !entry.ok)).toEqual([])
    const sender = messages
      .flatMap((info) => Option.toArray(Translate.message(info)))
      .find((info) => info.type === "user")
    expect(sender).toMatchObject({ sender: { userId: "user_1" } })
  }).pipe(Effect.scoped, Effect.runPromise))
