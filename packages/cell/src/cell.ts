export * as Cell from "./cell.js"

import { Brain } from "@ren/schema/brain"
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
import { FetchHttpClient } from "effect/http"
import type { State as BrainApiState } from "@ren/host-api/brain-api"
import manifest from "../package.json"
import { AppStore } from "./app-store.js"
import { ChannelStore } from "./channel-store.js"
import { MemoryStore } from "./memory-store.js"
import { BrainStorage } from "./brain-storage.js"
import { Env } from "./env.js"
import { Fence } from "./fence.js"
import { Harness } from "./harness/harness.js"
import { CredentialEnv } from "./credential-env.js"
import { GitSources } from "./git-sources.js"
import { HostToken } from "./host-token.js"
import { Inference } from "./inference.js"
import { ModelStore } from "./model-store.js"
import { ModelRefresh } from "./model-refresh.js"
import { Reconcile } from "./reconcile.js"
import { Sync } from "./sync.js"
import { RenAddress } from "./ren-address.js"

export class Info extends Context.Service<
  Info,
  {
    readonly storage: Pick<DurableObjectStorage, "getAlarm" | "setAlarm">
    readonly brainId: Brain.ID
    readonly generation: number
    readonly version: string
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
    readonly pulledAt: Ref.Ref<Option.Option<DateTime.Utc>>
  }
>()("@ren/cell/Cell/Activity") {}

export class BrainRoutes extends Context.Service<
  BrainRoutes,
  { readonly owns: (pathname: string) => boolean; readonly fetch: (request: Request) => Promise<Response> }
>()("@ren/cell/Cell/BrainRoutes") {}

export class Chat extends Context.Service<
  Chat,
  { readonly owns: (pathname: string) => boolean; readonly fetch: (request: Request) => Promise<Response> }
>()("@ren/cell/Cell/Chat") {}

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
    brain: info.brainId,
    generation: info.generation,
    version: info.version,
    isOpen: opened.isOpen,
    holders: opened.holders,
    waitingSince: Option.getOrNull(yield* Ref.get(activity.waitingSince)),
    pulledAt: Option.getOrNull(yield* Ref.get(activity.pulledAt)),
    nextReconcileAt: alarm ? DateTime.makeUnsafe(alarm) : null,
  } satisfies BrainApiState
})

export const fetch = Effect.fn("Cell.fetch")(function* (request: Request) {
  const address = request.headers.get(RenAddress.header)
  if (address) yield* RenAddress.Service.use((ren) => ren.adopt(address))
  const brain = yield* BrainRoutes
  const chat = yield* Chat
  const pathname = new URL(request.url).pathname
  if (brain.owns(pathname)) return yield* Effect.promise(() => brain.fetch(request))
  if (chat.owns(pathname)) return yield* Effect.promise(() => chat.fetch(request))
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
      const stream: { readonly readable: ReadableStream; readonly writable: WritableStream } =
        "IdentityTransformStream" in globalThis ? new IdentityTransformStream() : new TransformStream()
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
        // ast-grep-ignore: require-fork-error-handling, -- joined below: its failure reaches the alarm
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

export const activityLayer = Layer.effect(
  Activity,
  Effect.all({
    requests: Ref.make(0),
    wait: FiberHandle.make<void>(),
    waitingSince: Ref.make(Option.none<DateTime.Utc>()),
    configuring: Semaphore.make(1),
    closedIdle: Ref.make(false),
    pulledAt: Ref.make(Option.none<DateTime.Utc>()),
  }),
)

export const hostLayer = Layer.unwrap(
  Effect.gen(function* () {
    const cell = yield* Info
    const behindEgress = cell.vars.REN_EGRESS === "1"
    return (behindEgress ? ModelRefresh.layerEgress : ModelRefresh.layer(cell.vars.REN_URL)).pipe(
      Layer.provideMerge(behindEgress ? HostToken.layerEgress : HostToken.layer(cell.vars.REN_URL)),
      Layer.provideMerge(GitSources.layer),
      Layer.provideMerge(
        Layer.mergeAll(
          ModelStore.layer,
          CredentialEnv.layer,
          AppStore.layer,
          ChannelStore.layer,
          MemoryStore.layer,
          Inference.layer,
        ),
      ),
      Layer.provideMerge(Fence.layer),
      Layer.provide(RenAddress.http),
      Layer.provide(FetchHttpClient.layer),
      Layer.provideMerge(behindEgress ? RenAddress.layerFixed(cell.vars.REN_URL) : RenAddress.layer(cell.vars.REN_URL)),
    )
  }),
)

export const layer = (storage: DurableObjectStorage, name: string | undefined, env: unknown) => {
  const info = Layer.effect(
    Info,
    Effect.gen(function* () {
      if (!name) return yield* Effect.die(new Error("A brain cell has no name, so no brain id"))
      const vars = yield* Schema.decodeUnknownEffect(Env.Vars)(env).pipe(Effect.orDie)
      if (vars.REN_TELEMETRY)
        yield* Effect.logWarning("REN_TELEMETRY is set, but a brain in a Durable Object does not export telemetry yet")
      return {
        storage,
        brainId: yield* Schema.decodeUnknownEffect(Brain.ID)(name).pipe(Effect.orDie),
        generation: 1,
        version: manifest.version,
        vars,
      }
    }),
  )
  const sync = Layer.unwrap(
    Effect.gen(function* () {
      const cell = yield* Info
      return Sync.layer(storage, cell.vars.REN_URL)
    }),
  )
  return Layer.mergeAll(activityLayer, sync).pipe(
    Layer.provideMerge(hostLayer),
    Layer.provideMerge(Layer.succeed(BrainStorage.Service, storage)),
    Layer.provideMerge(info),
  )
}
