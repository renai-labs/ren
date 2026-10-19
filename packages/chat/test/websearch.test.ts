import { describe, expect, test } from "bun:test"
import { Form } from "@ren/schema/form"
import type { SessionEvent } from "@ren/schema/session-event"
import { Deferred, Effect, Fiber, PubSub, Schema } from "effect"
import { WebSearch } from "../src/websearch.js"
import { Fixture } from "./lib/fixture.js"

const decodeForm = Schema.decodeUnknownSync(Form.Info)

const consent = decodeForm({
  id: "frm_consent",
  sessionID: "ses_child",
  title: "Web Search",
  kind: "websearch.provider",
  fields: [{ key: "choice", type: "string", required: true, custom: false }],
})

const options = [
  { value: "exa", label: "Exa" },
  { value: "parallel", label: "Parallel" },
]

const provider = decodeForm({
  ...consent,
  id: "frm_provider",
  fields: [{ key: "provider", type: "string", required: true, custom: false, options }],
})

interface Reply {
  readonly sessionID: string
  readonly formID: string
  readonly answer: Form.Answer
}

const fixture = Effect.gen(function* () {
  const events = yield* PubSub.unbounded<SessionEvent.Event>()
  const replies: Array<Reply> = []
  const chose = yield* Deferred.make<void>()
  const emit = (type: SessionEvent.Type, data: object) =>
    PubSub.publish(events, Fixture.event({ id: `evt_${type}`, created: 0, type, data })).pipe(Effect.asVoid)
  return {
    events,
    replies,
    chose,
    record: (form: Form.Info, answer: Form.Answer) =>
      Effect.sync(() => replies.push({ sessionID: form.sessionID, formID: form.id, answer })).pipe(
        Effect.andThen(answer.choice === "choose" ? Deferred.succeed(chose, undefined) : Effect.void),
        Effect.asVoid,
      ),
    create: (form: Form.Info = provider) => emit("form.created", { form }),
    cancel: (id: string) => emit("form.cancelled", { id, sessionID: consent.sessionID }),
    answer: (id: string, answer: Form.Answer) => emit("form.replied", { id, sessionID: consent.sessionID, answer }),
  }
})

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

describe("web search desktop consent", () => {
  test.each([
    ["random", "allow"],
    [false, "disable"],
  ] as const)("submits %s without a second form", (selection, choice) =>
    run(
      Effect.gen(function* () {
        const input = yield* fixture
        yield* WebSearch.reply({ form: consent, selection, reply: input.record, events: input.events })
        expect(input.replies).toEqual([{ sessionID: consent.sessionID, formID: consent.id, answer: { choice } }])
      }),
    ),
  )

  test("subscribes before the first reply and answers the owning session's provider form", () =>
    run(
      Effect.gen(function* () {
        const input = yield* fixture
        yield* WebSearch.reply({
          form: consent,
          selection: "parallel",
          events: input.events,
          reply: (form, answer) =>
            input.record(form, answer).pipe(Effect.andThen(answer.choice === "choose" ? input.create() : Effect.void)),
        })
        expect(input.replies).toEqual([
          { sessionID: consent.sessionID, formID: consent.id, answer: { choice: "choose" } },
          { sessionID: consent.sessionID, formID: provider.id, answer: { provider: "parallel" } },
        ])
      }),
    ))

  test("ignores questions, other sessions, and repeated consent forms during handoff", () =>
    run(
      Effect.gen(function* () {
        const input = yield* fixture
        const pending = yield* WebSearch.reply({
          form: consent,
          selection: "exa",
          reply: input.record,
          events: input.events,
        }).pipe(Effect.forkChild)
        yield* Deferred.await(input.chose)
        yield* input.create({ ...provider, sessionID: "ses_other" })
        yield* input.create({ ...provider, kind: "question" })
        yield* input.create(consent)
        yield* input.create()
        yield* Fiber.join(pending)
        expect(input.replies).toHaveLength(2)
        expect(input.replies[1]?.formID).toBe(provider.id)
      }),
    ))

  test("leaves a changed provider list for explicit confirmation", () =>
    run(
      Effect.gen(function* () {
        const input = yield* fixture
        const pending = yield* WebSearch.reply({
          form: consent,
          selection: "removed",
          reply: input.record,
          events: input.events,
        }).pipe(Effect.forkChild)
        yield* Deferred.await(input.chose)
        yield* input.create()
        yield* Fiber.join(pending)
        expect(input.replies).toHaveLength(1)
      }),
    ))

  test("supports direct entry into the provider form", () =>
    run(
      Effect.gen(function* () {
        const input = yield* fixture
        yield* WebSearch.reply({ form: provider, selection: "exa", reply: input.record, events: input.events })
        expect(input.replies).toEqual([
          { sessionID: consent.sessionID, formID: provider.id, answer: { provider: "exa" } },
        ])
      }),
    ))

  test("does not misrepresent cancelling the provider form as disabling search", () =>
    run(
      Effect.gen(function* () {
        const input = yield* fixture
        yield* WebSearch.reply({ form: provider, selection: false, reply: input.record, events: input.events })
        expect(input.replies).toEqual([])
      }),
    ))

  test.each(["cancel", "other-client", "abort", "disconnect"])("ends a pending handoff on %s", (action) =>
    run(
      Effect.gen(function* () {
        const input = yield* fixture
        const lost = yield* Deferred.make<void>()
        const pending = yield* WebSearch.reply({
          form: consent,
          selection: "exa",
          reply: input.record,
          events: input.events,
          lost: Deferred.await(lost),
        }).pipe(Effect.forkChild)
        yield* Deferred.await(input.chose)
        if (action === "cancel") yield* input.cancel(consent.id)
        if (action === "other-client") yield* input.answer(consent.id, { choice: "disable" })
        if (action === "abort") yield* Fiber.interrupt(pending)
        if (action === "disconnect") yield* Deferred.succeed(lost, undefined)
        yield* Fiber.await(pending)
        yield* input.create()
        expect(input.replies).toHaveLength(1)
      }),
    ),
  )

  test.each([consent.id, provider.id])("propagates a failed %s submission and cleans up", (failing) =>
    run(
      Effect.gen(function* () {
        const input = yield* fixture
        const failed = yield* WebSearch.reply({
          form: consent,
          selection: "exa",
          events: input.events,
          reply: (form) =>
            form.id === failing ? Effect.fail(new Error("offline")) : input.create().pipe(Effect.asVoid),
        }).pipe(Effect.flip)
        expect(failed.message).toBe("offline")
      }),
    ),
  )
})

describe("web search request state", () => {
  test("direct provider requests need confirmation and do not load a different provider list", () => {
    expect(WebSearch.providerField(consent)).toBeUndefined()
    expect(WebSearch.providerField(provider)?.options).toEqual(options)
    expect(WebSearch.selected(consent, options, "random")).toBe("random")
    expect(WebSearch.selected(provider, options, "random")).toBe("exa")
    expect(WebSearch.selected(provider, options, "parallel")).toBe("parallel")
  })
})
