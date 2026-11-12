export * as Connection from "./connection.js"

import type { SessionEvent } from "@ren/schema/session/event"
import {
  Clock,
  Data,
  type Duration,
  Effect,
  Exit,
  Fiber,
  FiberHandle,
  Latch,
  Option,
  Pull,
  Ref,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect"

export type Status = "connecting" | "connected" | "reconnecting" | "parked"

type Ended = (typeof SessionEvent.Ended.Type)["data"]["reason"]

export class Lost extends Data.TaggedError("Connection.Lost")<{
  readonly message: string
  readonly cause?: unknown
  readonly timedOut?: boolean
}> {}

export interface Options {
  readonly subscribe: Effect.Effect<Stream.Stream<SessionEvent.Frame, unknown>, unknown>
  readonly onFrames: (frames: ReadonlyArray<SessionEvent.Frame>) => Effect.Effect<void>
  readonly onStatus: (status: Status) => Effect.Effect<void>
  readonly canReconnect?: Effect.Effect<boolean>
  // oxlint-disable-next-line ren/no-comments -- The brain's URL took no connection, for example a paused sandbox: the next access asks Ren to check the sandbox, which wakes it (#196).
  readonly onUnreachable?: Effect.Effect<void>
  readonly connectTimeout?: Duration.Input
  readonly idleTimeout?: Duration.Input
  readonly reconnectDelay?: number
  readonly maxReconnectDelay?: number
  readonly flushInterval?: Duration.Input
}

export interface Connection {
  readonly status: SubscriptionRef.SubscriptionRef<Status>
  readonly wake: Effect.Effect<void>
  readonly resync: (reason: string) => Effect.Effect<void>
  readonly foreground: Effect.Effect<void>
}

export const defaults = {
  connectTimeout: "2 seconds",
  idleTimeout: "45 seconds",
  reconnectDelay: 1_000,
  maxReconnectDelay: 15_000,
  flushInterval: "16 millis",
} as const

export const unreachableAfterTimeouts = 2

export const foregroundIdleThreshold = 20_000

export const make = Effect.fnUntraced(function* (options: Options) {
  const settings = { ...defaults, ...options }
  const scope = yield* Effect.scope
  const status = yield* SubscriptionRef.make<Status>("connecting")
  const buffer = yield* Ref.make<ReadonlyArray<SessionEvent.Frame>>([])
  const flushing = yield* Ref.make(false)
  const applying = yield* Semaphore.make(1)
  const awake = yield* Latch.make(true)
  const forced = yield* Ref.make(false)
  const attempt = yield* Ref.make(0)
  const timeouts = yield* Ref.make(0)
  const current = yield* FiberHandle.make<Ended, Lost>()
  const activity = yield* Ref.make(0)

  const touch = Effect.flatMap(Clock.currentTimeMillis, (now) => Ref.set(activity, now))

  const setStatus = Effect.fnUntraced(function* (next: Status) {
    // oxlint-disable-next-line ren/no-comments -- Each retry reports reconnecting again; publishing it again would make every reader of the status ask Ren for access again (#196).
    if ((yield* SubscriptionRef.get(status)) === next) return
    yield* options.onStatus(next)
    yield* SubscriptionRef.set(status, next)
  })

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
          orElse: () => Effect.fail(new Lost({ message: "Timed out connecting to the session", timedOut: true })),
        }),
      )
      if (opening.at(0)?.type !== "server.connected")
        return yield* new Lost({ message: "The event stream did not start with server.connected" })
      yield* Ref.set(attempt, 0)
      yield* Ref.set(timeouts, 0)
      yield* setStatus("connected")
      yield* publish(opening)
      const read: Effect.Effect<Ended, Lost> = next.pipe(
        Effect.timeoutOrElse({ duration: settings.idleTimeout, orElse: lost("The event stream stalled") }),
        Effect.tap(publish),
        Effect.flatMap((frames) => {
          const end = frames.find((frame) => frame.type === "stream.ended")
          return end ? Effect.succeed(end.data.reason) : read
        }),
      )
      return yield* read
    }).pipe(Effect.scoped)

  const cycle = Effect.gen(function* () {
    yield* awake.await
    const count = yield* Ref.get(attempt)
    const fiber = yield* FiberHandle.run(current, connect(count === 0))
    const exit = yield* Fiber.await(fiber)
    // oxlint-disable-next-line ren/no-comments -- closing: the client token expired (E49), so the runtime reconnects at once with new access; only idle parks (E127).
    if (Exit.isSuccess(exit) && exit.value === "closing") {
      yield* Ref.set(attempt, 1)
      return yield* setStatus("reconnecting")
    }
    if (Exit.isSuccess(exit) || (options.canReconnect && !(yield* options.canReconnect))) {
      yield* awake.close
      yield* Ref.set(attempt, 0)
      return yield* setStatus("parked")
    }
    const failures = yield* Ref.updateAndGet(attempt, (previous) => previous + 1)
    if (Option.exists(Exit.findErrorOption(exit), (error) => error.timedOut === true)) {
      const timedOut = yield* Ref.updateAndGet(timeouts, (previous) => previous + 1)
      if (timedOut >= unreachableAfterTimeouts && options.onUnreachable) {
        yield* Ref.set(timeouts, 0)
        yield* options.onUnreachable
      }
    } else yield* Ref.set(timeouts, 0)
    yield* setStatus("reconnecting")
    if (yield* Ref.getAndSet(forced, false)) return
    yield* Effect.sleep(Math.min(settings.reconnectDelay * 2 ** (failures - 1), settings.maxReconnectDelay))
  })

  yield* Effect.forkIn(Effect.forever(cycle), scope)

  const wake = awake.open.pipe(Effect.asVoid)

  const resync = (reason: string) =>
    Effect.gen(function* () {
      if ((yield* SubscriptionRef.get(status)) !== "connected") return
      yield* Effect.logInfo("The chat event stream resyncs", { reason })
      yield* Ref.set(forced, true)
      yield* FiberHandle.clear(current)
    })

  return {
    status,
    wake,
    resync,
    foreground: Effect.gen(function* () {
      yield* wake
      if ((yield* Clock.currentTimeMillis) - (yield* Ref.get(activity)) < foregroundIdleThreshold) return
      yield* resync("The page returned to the foreground after the event stream went quiet")
    }),
  } satisfies Connection
})
