import { expect, test } from "bun:test"
import type { SessionEvent } from "@ren/schema/session/event"
import { type Cause, Deferred, Effect, Queue, type Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import { Connection } from "../src/connection.js"

const effect = <A, E>(name: string, body: () => Effect.Effect<A, E, Scope.Scope>) =>
  test(name, () => body().pipe(Effect.scoped, Effect.provide(TestClock.layer()), Effect.runPromise))

const connected: SessionEvent.Frame = { id: "evt_connected", created: 1, type: "server.connected", data: {} }
const heartbeat: SessionEvent.Frame = { id: "evt_heartbeat", created: 1, type: "server.heartbeat", data: {} }
const ended: SessionEvent.Frame = { id: "evt_ended", created: 1, type: "stream.ended", data: { reason: "idle" } }

interface Subscription {
  readonly queue: Queue.Queue<SessionEvent.Frame, Error | Cause.Done>
  readonly closed: Deferred.Deferred<void>
}

const setup = (options: Partial<Pick<Connection.Options, "idleTimeout" | "connectTimeout">> = {}) =>
  Effect.gen(function* () {
    const subscriptions = yield* Queue.unbounded<Subscription>()
    const statuses = yield* Queue.unbounded<Connection.Status>()
    const frames = yield* Queue.unbounded<SessionEvent.Frame>()
    const connection = yield* Connection.make({
      ...options,
      flushInterval: 0,
      subscribe: Effect.gen(function* () {
        const subscription = {
          queue: yield* Queue.unbounded<SessionEvent.Frame, Error | Cause.Done>(),
          closed: yield* Deferred.make<void>(),
        }
        yield* Queue.offer(subscriptions, subscription)
        return Stream.fromQueue(subscription.queue).pipe(
          Stream.ensuring(Deferred.succeed(subscription.closed, undefined)),
        )
      }),
      onFrames: (batch) => Queue.offerAll(frames, batch).pipe(Effect.asVoid),
      onStatus: (status) => Queue.offer(statuses, status).pipe(Effect.asVoid),
    })
    const until = (status: Connection.Status): Effect.Effect<void> =>
      Queue.take(statuses).pipe(Effect.flatMap((next) => (next === status ? Effect.void : until(status))))
    return { connection, subscriptions, statuses, frames, until }
  })

effect("a stream that goes silent past the idle timeout is replaced", () =>
  Effect.gen(function* () {
    const fake = yield* setup({ idleTimeout: "45 seconds" })
    const first = yield* Queue.take(fake.subscriptions)
    yield* Queue.offer(first.queue, connected)
    yield* fake.until("connected")
    expect(yield* Queue.take(fake.frames)).toEqual(connected)

    yield* TestClock.adjust("45 seconds")
    yield* fake.until("reconnecting")
    yield* Deferred.await(first.closed)
    yield* TestClock.adjust("1 second")
    const second = yield* Queue.take(fake.subscriptions)
    yield* Queue.offer(second.queue, { ...connected, id: "evt_connected_2" })
    yield* fake.until("connected")
    expect(yield* Queue.take(fake.frames)).toEqual({ ...connected, id: "evt_connected_2" })
    expect(yield* fake.connection.status).toBe("connected")
  }),
)

effect("keepalive comments hold a quiet stream open", () =>
  Effect.gen(function* () {
    const fake = yield* setup({ idleTimeout: "45 seconds" })
    const first = yield* Queue.take(fake.subscriptions)
    yield* Queue.offer(first.queue, connected)
    yield* fake.until("connected")

    yield* Effect.forEach(
      Array.from({ length: 5 }),
      () => Queue.offer(first.queue, heartbeat).pipe(Effect.andThen(TestClock.adjust("20 seconds"))),
      { discard: true },
    )

    expect(yield* Queue.size(fake.subscriptions)).toBe(0)
    expect(yield* Deferred.isDone(first.closed)).toBe(false)
    expect(yield* fake.connection.status).toBe("connected")
    expect((yield* Queue.takeAll(fake.frames)).filter((frame) => frame.type !== "server.heartbeat")).toEqual([
      connected,
    ])
  }),
)

effect("a forced resync replaces the stream immediately and only while connected", () =>
  Effect.gen(function* () {
    const fake = yield* setup()
    yield* fake.connection.resync("too early")
    const first = yield* Queue.take(fake.subscriptions)
    expect(yield* Deferred.isDone(first.closed)).toBe(false)
    yield* Queue.offer(first.queue, connected)
    yield* fake.until("connected")

    yield* fake.connection.resync("Network connection restored")
    const second = yield* Queue.take(fake.subscriptions)
    expect(yield* Deferred.isDone(first.closed)).toBe(true)
    yield* Queue.offer(second.queue, connected)
    yield* fake.until("connected")
  }),
)

effect("a page back in the foreground resyncs only a stream that went quiet", () =>
  Effect.gen(function* () {
    const fake = yield* setup()
    const first = yield* Queue.take(fake.subscriptions)
    yield* Queue.offer(first.queue, connected)
    yield* fake.until("connected")

    yield* TestClock.adjust("15 seconds")
    yield* fake.connection.foreground
    expect(yield* Deferred.isDone(first.closed)).toBe(false)

    yield* TestClock.adjust("5 seconds")
    yield* fake.connection.foreground
    const second = yield* Queue.take(fake.subscriptions)
    expect(yield* Deferred.isDone(first.closed)).toBe(true)
    yield* Queue.offer(second.queue, connected)
    yield* fake.until("connected")
  }),
)

test.each([
  ["closes", (queue: Subscription["queue"]) => Queue.end(queue)],
  ["fails", (queue: Subscription["queue"]) => Queue.fail(queue, new Error("contract failure"))],
] as const)("a stream the server %s reconnects and reports the disconnect", (_name, end) =>
  Effect.gen(function* () {
    const fake = yield* setup()
    const first = yield* Queue.take(fake.subscriptions)
    yield* Queue.offer(first.queue, connected)
    yield* fake.until("connected")

    yield* end(first.queue)
    yield* fake.until("reconnecting")
    yield* TestClock.adjust("1 second")
    const second = yield* Queue.take(fake.subscriptions)
    yield* Queue.offer(second.queue, connected)
    yield* fake.until("connected")
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer()), Effect.runPromise),
)

effect("a stream that does not start with server.connected is replaced", () =>
  Effect.gen(function* () {
    const fake = yield* setup()
    const first = yield* Queue.take(fake.subscriptions)
    yield* Queue.offer(first.queue, heartbeat)
    yield* fake.until("reconnecting")
    yield* TestClock.adjust("1 second")
    const second = yield* Queue.take(fake.subscriptions)
    yield* TestClock.adjust("2 seconds")
    yield* fake.until("reconnecting")
    yield* Deferred.await(second.closed)
    expect(yield* Queue.size(fake.frames)).toBe(0)
  }),
)

effect("frames that arrive together apply in one batch", () =>
  Effect.gen(function* () {
    const batches = yield* Queue.unbounded<ReadonlyArray<SessionEvent.Frame>>()
    const subscriptions = yield* Queue.unbounded<Queue.Queue<SessionEvent.Frame, Cause.Done>>()
    yield* Connection.make({
      subscribe: Effect.gen(function* () {
        const queue = yield* Queue.unbounded<SessionEvent.Frame, Cause.Done>()
        yield* Queue.offer(subscriptions, queue)
        return Stream.fromQueue(queue)
      }),
      onFrames: (frames) => Queue.offer(batches, frames).pipe(Effect.asVoid),
      onStatus: () => Effect.void,
    })
    const queue = yield* Queue.take(subscriptions)
    yield* Queue.offerAll(queue, [connected, heartbeat, heartbeat])
    yield* TestClock.adjust("16 millis")
    expect(yield* Queue.take(batches)).toEqual([connected, heartbeat, heartbeat])
  }),
)

effect("a stream.ended frame parks the connection until it is woken", () =>
  Effect.gen(function* () {
    const fake = yield* setup()
    const first = yield* Queue.take(fake.subscriptions)
    yield* Queue.offer(first.queue, connected)
    yield* fake.until("connected")
    yield* Queue.offer(first.queue, ended)
    yield* fake.until("parked")
    yield* Deferred.await(first.closed)
    yield* TestClock.adjust("1 minute")
    expect(yield* Queue.size(fake.subscriptions)).toBe(0)

    yield* fake.connection.wake
    yield* fake.until("connecting")
    const second = yield* Queue.take(fake.subscriptions)
    yield* Queue.offer(second.queue, connected)
    yield* fake.until("connected")
  }),
)
