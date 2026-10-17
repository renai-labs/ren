export * as Cell from "./cell.js"

import { Session } from "@ren/schema/session"
import {
  Clock,
  Context,
  DateTime,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  FiberHandle,
  Layer,
  Option,
  Ref,
  Schema,
  Semaphore,
} from "effect"
import { Env } from "./env.js"
import { Harness } from "./harness/harness.js"
import { HostToken } from "./host-token.js"
import { ModelStore } from "./model-store.js"
import { ModelRefresh } from "./model-refresh.js"
import { Reconcile } from "./reconcile.js"
import { Sync } from "./sync.js"

export class Info extends Context.Service<
  Info,
  {
    readonly storage: Pick<DurableObjectStorage, "getAlarm" | "setAlarm">
    readonly sessionId: Session.ID
    readonly vars: Env.Vars
  }
>()("@ren/cell/Cell/Info") {}

export class Activity extends Context.Service<
  Activity,
  {
    readonly requests: Ref.Ref<number>
    readonly wait: FiberHandle.FiberHandle<void>
    readonly waitingSince: Ref.Ref<Option.Option<DateTime.Utc>>
    readonly configuring: Semaphore.Semaphore
    readonly closedIdle: Ref.Ref<boolean>
  }
>()("@ren/cell/Cell/Activity") {}

export class Brain extends Context.Service<
  Brain,
  { readonly owns: (pathname: string) => boolean; readonly fetch: (request: Request) => Promise<Response> }
>()("@ren/cell/Cell/Brain") {}

export const acquire = Effect.gen(function* () {
  const info = yield* Info
  const activity = yield* Activity
  const harness = yield* Harness.Service
  yield* Ref.update(activity.requests, (count) => count + 1)
  if (!(yield* Effect.promise(() => info.storage.getAlarm()))) {
    const now = yield* Clock.currentTimeMillis
    yield* Effect.promise(() => info.storage.setAlarm(now + info.vars.ALARM_INTERVAL_MS))
  }
  return yield* harness.get
})

export const state = Effect.gen(function* () {
  const info = yield* Info
  const activity = yield* Activity
  const harness = yield* Harness.Service
  const opened = yield* harness.state
  const alarm = yield* Effect.promise(() => info.storage.getAlarm())
  return {
    isOpen: opened.isOpen,
    holders: opened.holders,
    waitingSince: Option.getOrNull(yield* Ref.get(activity.waitingSince)),
    nextReconcileAt: alarm ? DateTime.makeUnsafe(alarm) : null,
  } satisfies Session.HostState
})

export const fetch = Effect.fn("Cell.fetch")(function* (request: Request) {
  const brain = yield* Brain
  if (brain.owns(new URL(request.url).pathname)) return yield* Effect.promise(() => brain.fetch(request))
  const ready = yield* Deferred.make<Response>()
  yield* Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* acquire
      const response = yield* Effect.promise(() => harness.fetch(request))
      const body = response.body
      if (!body) {
        yield* Deferred.succeed(ready, response)
        return
      }
      const stream = new IdentityTransformStream()
      yield* Deferred.succeed(ready, new Response(stream.readable, response))
      yield* Effect.tryPromise(() => body.pipeTo(stream.writable)).pipe(Effect.ignore)
    }),
  ).pipe(
    Effect.onExit((exit) => (Exit.isFailure(exit) ? Deferred.failCause(ready, exit.cause) : Effect.void)),
    Effect.forkDetach,
  )
  return yield* Deferred.await(ready)
})

export const alarm = Effect.fn("Cell.alarm")(function* () {
  const info = yield* Info
  const activity = yield* Activity
  const harness = yield* Harness.Service
  const sync = yield* Sync.Service
  const pending = yield* sync.step
  const schedule = (delay: Duration.Duration) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      Effect.promise(() => info.storage.setAlarm(now + Duration.toMillis(delay))),
    )
  const interval = Duration.millis(info.vars.ALARM_INTERVAL_MS)
  const rearm = schedule(
    Option.match(pending, { onNone: () => interval, onSome: (delay) => Duration.min(delay, interval) }),
  )
  const resync = Option.match(pending, { onNone: () => Effect.void, onSome: schedule })
  if (activity.wait.state._tag === "Open" && activity.wait.state.fiber) return yield* rearm
  // oxlint-disable-next-line ren/no-comments -- Only this process's reconcile closed the harness, and any request reopens it, so nothing is left to reconcile. After a restart the flag is false, and reconcile reopens the harness to resume a turn.
  if ((yield* Ref.get(activity.closedIdle)) && !(yield* harness.state).isOpen) return yield* resync
  const requests = yield* Ref.get(activity.requests)
  const idle = yield* Effect.scoped(
    Effect.gen(function* () {
      const opened = yield* harness.get
      const labelled = (yield* opened.sessions).map((session) => ({
        session,
        work: Reconcile.work(session, info.vars.PARK_AFTER_MS),
      }))
      yield* Effect.forEach(
        labelled,
        (entry) => {
          if (entry.work._tag === "Unanswered") return entry.session.interrupt
          if (entry.work._tag === "Queued") return entry.session.resend(entry.work.item.id)
          return Effect.void
        },
        { discard: true },
      )
      const running = labelled.filter((entry) => entry.work._tag === "Running")
      if (running.length > 0) {
        // oxlint-disable-next-line ren/no-comments -- The order is the crash guarantee: the next alarm is set before the wait, so a cell that dies mid-wait reopens and resumes.
        yield* rearm
        const fiber = yield* FiberHandle.run(
          activity.wait,
          Effect.gen(function* () {
            yield* Ref.set(activity.waitingSince, Option.some(yield* DateTime.now))
            yield* Effect.forEach(
              running,
              (entry) =>
                entry.session.wait(
                  Option.match(Option.fromNullishOr(entry.session.questionAgeMs), {
                    onNone: () => info.vars.WAIT_BUDGET_MS,
                    onSome: (age) => Math.min(info.vars.WAIT_BUDGET_MS, info.vars.PARK_AFTER_MS - age),
                  }),
                ),
              { concurrency: "unbounded", discard: true },
            )
          }).pipe(Effect.ensuring(Ref.set(activity.waitingSince, Option.none()))),
        )
        yield* Fiber.join(fiber).pipe(Effect.ensuring(Fiber.interrupt(fiber)))
      }
      return labelled.every((entry) => entry.work._tag === "Idle")
    }),
  )
  const held = (yield* harness.state).holders > 0
  if (!idle || held || (yield* Ref.get(activity.requests)) !== requests) return yield* rearm
  yield* harness.close
  yield* Ref.set(activity.closedIdle, true)
  yield* resync
})

export const layer = (storage: DurableObjectStorage, name: string | undefined, env: unknown) => {
  const info = Layer.effect(
    Info,
    Effect.gen(function* () {
      if (!name) return yield* Effect.die(new Error("A session cell has no name, so no session id"))
      return {
        storage,
        sessionId: yield* Schema.decodeUnknownEffect(Session.ID)(name).pipe(Effect.orDie),
        vars: yield* Schema.decodeUnknownEffect(Env.Vars)(env).pipe(Effect.orDie),
      }
    }),
  )
  const refresh = Layer.unwrap(
    Effect.gen(function* () {
      const cell = yield* Info
      return ModelRefresh.layer(cell.vars.REN_URL).pipe(
        Layer.provideMerge(HostToken.layer(cell.vars.REN_URL, cell.vars.CELL_KEYS)),
      )
    }),
  )
  const activity = Layer.effect(
    Activity,
    Effect.all({
      requests: Ref.make(0),
      wait: FiberHandle.make<void>(),
      waitingSince: Ref.make(Option.none<DateTime.Utc>()),
      configuring: Semaphore.make(1),
      closedIdle: Ref.make(false),
    }),
  )
  const sync = Layer.unwrap(
    Effect.gen(function* () {
      const cell = yield* Info
      return Sync.layer(storage.sql, cell.vars.REN_URL)
    }),
  )
  const models = ModelStore.layer.pipe(Layer.provideMerge(Layer.succeed(ModelStore.Storage, storage)))
  return Layer.mergeAll(activity, sync).pipe(
    Layer.provideMerge(refresh),
    Layer.provideMerge(models),
    Layer.provideMerge(info),
  )
}
