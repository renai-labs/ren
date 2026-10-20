import { expect, test } from "bun:test"
import { Form } from "@ren/schema/form"
import { Deferred, Effect, Exit, Fiber, Queue, Ref, Schema, Scope, SubscriptionRef } from "effect"
import { ChatState } from "../src/chat-state.js"
import { Hydrate } from "../src/hydrate.js"
import { Reads } from "../src/reads.js"
import { Reducer } from "../src/reducer.js"
import { Fixture } from "./lib/fixture.js"

const effect = <A, E>(name: string, body: () => Effect.Effect<A, E, Scope.Scope>) =>
  test(name, () => body().pipe(Effect.scoped, Effect.runPromise))

const server = Effect.gen(function* () {
  const requests = yield* Queue.unbounded<Deferred.Deferred<string, Error>>()
  const loaded = yield* Ref.make<string | undefined>(undefined)
  const count = yield* Ref.make(0)
  const load = Effect.gen(function* () {
    const response = yield* Deferred.make<string, Error>()
    yield* Ref.update(count, (value) => value + 1)
    yield* Queue.offer(requests, response)
    yield* Ref.set(loaded, yield* Deferred.await(response))
  })
  const respond = (value: string) =>
    Queue.take(requests).pipe(Effect.flatMap((response) => Deferred.succeed(response, value)))
  return { requests, loaded, count, load, respond }
})

const fork = Effect.forkChild({ startImmediately: true })

effect("a snapshot overtaken by live changes retries without erasing additions or resurrecting removals", () =>
  Effect.gen(function* () {
    const state = yield* SubscriptionRef.make(ChatState.empty)
    const requests = yield* Queue.unbounded<Deferred.Deferred<ReadonlyArray<Form.Info>>>()
    const answered = Schema.decodeUnknownSync(Form.Info)({
      id: "frm_answered",
      sessionID: Fixture.sessionID,
      title: "Question",
      kind: "question",
      fields: [{ key: "answer", type: "string" }],
    })
    const created = Schema.decodeUnknownSync(Form.Info)({
      id: "frm_created",
      sessionID: Fixture.sessionID,
      title: "Next question",
      kind: "question",
      fields: [{ key: "answer", type: "string" }],
    })
    const read = yield* fork(
      Reads.snapshot({
        state,
        select: (current) => current.forms[Fixture.sessionID],
        load: () =>
          Effect.gen(function* () {
            const response = yield* Deferred.make<ReadonlyArray<Form.Info>>()
            yield* Queue.offer(requests, response)
            return yield* Deferred.await(response)
          }),
        apply: (current, items) => Hydrate.forms(current, Fixture.sessionID, items),
      }),
    )
    const stale = yield* Queue.take(requests)
    yield* SubscriptionRef.update(
      state,
      (current) =>
        Reducer.apply(
          current,
          Fixture.event({
            id: "evt_cancelled",
            created: 1,
            type: "form.cancelled",
            data: { sessionID: Fixture.sessionID, id: answered.id },
          }),
        ).state,
    )
    yield* Deferred.succeed(stale, [answered])
    const fresh = yield* Queue.take(requests)
    expect((yield* SubscriptionRef.get(state)).forms[Fixture.sessionID]).toEqual([])
    yield* SubscriptionRef.update(
      state,
      (current) =>
        Reducer.apply(
          current,
          Fixture.event({
            id: "evt_created",
            created: 2,
            type: "form.created",
            data: { form: created },
          }),
        ).state,
    )
    yield* Deferred.succeed(fresh, [])
    const retry = yield* Queue.take(requests)
    expect((yield* SubscriptionRef.get(state)).forms[Fixture.sessionID]).toEqual([created])
    yield* SubscriptionRef.update(state, (current) => Hydrate.info(current, [Fixture.session(Fixture.sessionID)]))
    yield* Deferred.succeed(retry, [created])
    yield* Fiber.join(read)
    expect((yield* SubscriptionRef.get(state)).forms[Fixture.sessionID]).toEqual([created])
    expect((yield* SubscriptionRef.get(state)).info[Fixture.sessionID]).toBeDefined()
  }),
)

effect("a second sync of a loaded read does not refetch", () =>
  Effect.gen(function* () {
    const reads = yield* Reads.make<Error>()
    const api = yield* server
    const first = yield* fork(reads.run("messages", api.load))
    yield* api.respond("page")
    yield* Fiber.join(first)
    yield* reads.run("messages", api.load)
    expect(yield* Ref.get(api.count)).toBe(1)
    expect(reads.has("messages")).toBe(true)
    expect(reads.pending("messages")).toBe(false)
  }),
)

effect("revalidates after an event overtakes an active session read", () =>
  Effect.gen(function* () {
    const reads = yield* Reads.make<Error>()
    const api = yield* server
    const initial = yield* fork(reads.run("info", api.load))
    const first = yield* Queue.take(api.requests)
    reads.invalidate("info")
    const revalidation = yield* fork(reads.run("info", api.load))
    yield* Deferred.succeed(first, "viewed 1")
    yield* Fiber.join(initial)
    yield* api.respond("viewed 2")
    yield* Fiber.join(revalidation)
    expect(yield* Ref.get(api.count)).toBe(2)
    expect(yield* Ref.get(api.loaded)).toBe("viewed 2")
    expect(reads.has("info")).toBe(true)
    expect(reads.pending("info")).toBe(false)
  }),
)

effect("invalidations that land before a queued reload starts are absorbed by it", () =>
  Effect.gen(function* () {
    const reads = yield* Reads.make<Error>()
    const api = yield* server
    const first = yield* fork(reads.run("agent", api.load))
    const request = yield* Queue.take(api.requests)
    reads.invalidate("agent")
    const second = yield* fork(reads.run("agent", api.load))
    reads.invalidate("agent")
    const third = yield* fork(reads.run("agent", api.load))
    reads.invalidate("agent")
    yield* Effect.yieldNow
    expect(yield* Ref.get(api.count)).toBe(1)
    yield* Deferred.succeed(request, "empty")
    yield* Fiber.join(first)
    yield* api.respond("reviewer")
    yield* Fiber.join(second)
    yield* Fiber.join(third)
    expect(yield* Ref.get(api.count)).toBe(2)
    yield* reads.run("agent", api.load)
    expect(yield* Ref.get(api.count)).toBe(2)
    expect(yield* Ref.get(api.loaded)).toBe("reviewer")
  }),
)

effect("event refreshes report failures, remain retryable, and preserve explicit read errors", () =>
  Effect.gen(function* () {
    const reads = yield* Reads.make<Error>()
    const api = yield* server
    const explicit = yield* fork(reads.run("info", api.load))
    const joined = yield* fork(reads.run("info", api.load))
    yield* Queue.take(api.requests).pipe(
      Effect.flatMap((response) => Deferred.fail(response, new Error("Failed to fetch"))),
    )
    expect(yield* Fiber.await(explicit)).toEqual(Exit.fail(new Error("Failed to fetch")))
    expect(yield* Fiber.await(joined)).toEqual(Exit.fail(new Error("Failed to fetch")))
    expect(reads.has("info")).toBe(false)
    const retry = yield* fork(reads.run("info", api.load))
    yield* api.respond("Recovered")
    yield* Fiber.join(retry)
    expect(yield* Ref.get(api.loaded)).toBe("Recovered")
    expect(yield* Ref.get(api.count)).toBe(2)
  }),
)

effect("a completed read skips its fetch until it is invalidated", () =>
  Effect.gen(function* () {
    const reads = yield* Reads.make<Error>()
    const api = yield* server
    reads.complete("pending")
    yield* reads.run("pending", api.load)
    expect(yield* Ref.get(api.count)).toBe(0)
    reads.invalidate("pending")
    expect(reads.has("pending")).toBe(false)
    const reload = yield* fork(reads.run("pending", api.load))
    reads.complete("pending")
    expect(reads.pending("pending")).toBe(true)
    yield* api.respond("loaded")
    yield* Fiber.join(reload)
    expect(yield* Ref.get(api.count)).toBe(1)
  }),
)

effect("a reconnect invalidates loaded and in-flight reads", () =>
  Effect.gen(function* () {
    const reads = yield* Reads.make<Error>()
    const api = yield* server
    reads.complete("info")
    const inflight = yield* fork(reads.run("messages", api.load))
    const request = yield* Queue.take(api.requests)
    reads.invalidate()
    expect(reads.has("info")).toBe(false)
    yield* Deferred.succeed(request, "stale")
    yield* Fiber.join(inflight)
    expect(reads.has("messages")).toBe(false)
    const reload = yield* fork(reads.run("messages", api.load))
    yield* api.respond("fresh")
    yield* Fiber.join(reload)
    expect(yield* Ref.get(api.loaded)).toBe("fresh")
  }),
)

effect("background reads respect disposed owners", () =>
  Effect.gen(function* () {
    const owner = yield* Scope.make()
    const reads = yield* Reads.make<Error>().pipe(Scope.provide(owner))
    const api = yield* server
    const joined = yield* fork(reads.run("command", api.load))
    yield* Queue.take(api.requests)
    yield* Scope.close(owner, Exit.void)
    expect(Exit.hasInterrupts(yield* Fiber.await(joined))).toBe(true)
  }),
)
