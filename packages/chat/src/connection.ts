export * as Connection from "./connection.js"

import type { SessionEvent } from "@ren/schema/session-event"
import {
  Clock,
  Data,
  type Duration,
  Effect,
  Exit,
  Fiber,
  FiberHandle,
  Latch,
  Pull,
  Ref,
  Semaphore,
  Stream,
} from "effect"

export type Status = "connecting" | "connected" | "reconnecting" | "parked"

export class Lost extends Data.TaggedError("Connection.Lost")<{ readonly message: string; readonly cause?: unknown }> {}

export interface Options {
  readonly subscribe: Effect.Effect<Stream.Stream<SessionEvent.Frame, unknown>, unknown>
  readonly onFrames: (frames: ReadonlyArray<SessionEvent.Frame>) => Effect.Effect<void>
  readonly onStatus: (status: Status) => Effect.Effect<void>
  readonly connectTimeout?: Duration.Input
  readonly idleTimeout?: Duration.Input
  readonly reconnectDelay?: number
  readonly flushInterval?: Duration.Input
}

export interface Connection {
  readonly status: Effect.Effect<Status>
  readonly wake: Effect.Effect<void>
  readonly resync: (reason: string) => Effect.Effect<void>
  readonly foreground: Effect.Effect<void>
}

export const defaults = {
  connectTimeout: "2 seconds",
  idleTimeout: "45 seconds",
  reconnectDelay: 1_000,
  flushInterval: "16 millis",
} as const

export const foregroundIdleThreshold = 20_000

export const make = Effect.fnUntraced(function* (options: Options) {
  const settings = { ...defaults, ...options }
  const scope = yield* Effect.scope
  const status = yield* Ref.make<Status>("connecting")
  const buffer = yield* Ref.make<ReadonlyArray<SessionEvent.Frame>>([])
  const flushing = yield* Ref.make(false)
  const applying = yield* Semaphore.make(1)
  const awake = yield* Latch.make(true)
  const forced = yield* Ref.make(false)
  const attempt = yield* Ref.make(0)
  const current = yield* FiberHandle.make<"ended", Lost>()
  const activity = yield* Ref.make(0)

  const touch = Effect.flatMap(Clock.currentTimeMillis, (now) => Ref.set(activity, now))

  const setStatus = (next: Status) => Ref.set(status, next).pipe(Effect.andThen(options.onStatus(next)))

  const flush = Effect.gen(function* () {
    yield* Effect.sleep(settings.flushInterval)
    yield* Ref.set(flushing, false)
    const frames = yield* Ref.getAndSet(buffer, [])
    if (frames.length > 0) yield* applying.withPermits(1)(options.onFrames(frames))
  })

  const publish = Effect.fnUntraced(function* (frames: ReadonlyArray<SessionEvent.Frame>) {
    yield* Ref.update(buffer, (pending) => [...pending, ...frames])
    if (!(yield* Ref.getAndSet(flushing, true))) yield* Effect.forkIn(flush, scope)
  })

  const lost = (message: string) => () => Effect.fail(new Lost({ message }))

  const connect = (first: boolean) =>
    Effect.gen(function* () {
      yield* setStatus(first ? "connecting" : "reconnecting")
      const pull = yield* options.subscribe.pipe(
        Effect.mapError((cause) => new Lost({ message: "Could not open the event stream", cause })),
        Effect.flatMap(Stream.toPull),
      )
      const next = pull.pipe(
        Effect.mapError((cause) => new Lost({ message: "The event stream failed", cause })),
        Pull.catchDone(lost("The event stream disconnected")),
        Effect.tap(() => touch),
      )
      const opening = yield* next.pipe(
        Effect.timeoutOrElse({
          duration: settings.connectTimeout,
          orElse: lost("Timed out connecting to the session"),
        }),
      )
      if (opening.at(0)?.type !== "server.connected")
        return yield* new Lost({ message: "The event stream did not start with server.connected" })
      yield* Ref.set(attempt, 0)
      yield* setStatus("connected")
      yield* publish(opening)
      const read: Effect.Effect<"ended", Lost> = next.pipe(
        Effect.timeoutOrElse({ duration: settings.idleTimeout, orElse: lost("The event stream stalled") }),
        Effect.tap(publish),
        Effect.flatMap((frames) =>
          frames.some((frame) => frame.type === "stream.ended") ? Effect.succeed("ended" as const) : read,
        ),
      )
      return yield* read
    }).pipe(Effect.scoped)

  const cycle = Effect.gen(function* () {
    yield* awake.await
    const count = yield* Ref.get(attempt)
    const startedAt = yield* Clock.currentTimeMillis
    const fiber = yield* FiberHandle.run(current, connect(count === 0))
    const exit = yield* Fiber.await(fiber)
    if (Exit.isSuccess(exit)) {
      yield* awake.close
      yield* Ref.set(attempt, 0)
      return yield* setStatus("parked")
    }
    const lasted = (yield* Clock.currentTimeMillis) - startedAt >= settings.reconnectDelay
    yield* Ref.set(attempt, lasted ? 1 : count + 1)
    yield* setStatus("reconnecting")
    if (yield* Ref.getAndSet(forced, false)) return
    yield* Effect.sleep(settings.reconnectDelay)
  })

  yield* Effect.forkIn(Effect.forever(cycle), scope)

  const wake = awake.open.pipe(Effect.asVoid)

  const resync = (reason: string) =>
    Effect.gen(function* () {
      if ((yield* Ref.get(status)) !== "connected") return
      yield* Effect.logInfo("The chat event stream resyncs", { reason })
      yield* Ref.set(forced, true)
      yield* FiberHandle.clear(current)
    })

  return {
    status: Ref.get(status),
    wake,
    resync,
    foreground: Effect.gen(function* () {
      yield* wake
      if ((yield* Clock.currentTimeMillis) - (yield* Ref.get(activity)) < foregroundIdleThreshold) return
      yield* resync("The page returned to the foreground after the event stream went quiet")
    }),
  } satisfies Connection
})
