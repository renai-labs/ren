export * as Probe from "./probe.js"

import type { ExecutorApi } from "@ren/hand-api/executor-api"
import { Executor } from "@ren/executor/executor"
import { Sandbox } from "@ren/executor/sandbox"
import { TestHand } from "@ren/executor/testing"
import { Clock, Duration, Effect, Layer, Ref, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientError } from "effect/http"
import { TestClock } from "effect/testing"

export interface Probe {
  readonly heartbeats: Ref.Ref<number>
  readonly pings: Ref.Ref<number>
  readonly spawns: Ref.Ref<number>
  readonly outputsOpen: Ref.Ref<number>
  readonly layer: NonNullable<Parameters<typeof TestHand.layer>[0]["executor"]>
}

export const make = (
  options: { readonly afterSpawn?: (result: ExecutorApi.SpawnResult) => Effect.Effect<void> } = {},
) =>
  Effect.gen(function* () {
    const heartbeats = yield* Ref.make(0)
    const pings = yield* Ref.make(0)
    const spawns = yield* Ref.make(0)
    const outputsOpen = yield* Ref.make(0)
    const layer = Layer.effect(
      Executor.Service,
      Effect.map(Executor.Service, (executor) =>
        Executor.Service.of({
          ...executor,
          spawn: (brain, input) =>
            Ref.update(spawns, (count) => count + 1).pipe(
              Effect.andThen(executor.spawn(brain, input)),
              Effect.tap(options.afterSpawn ?? (() => Effect.void)),
            ),
          heartbeat: (brain, id) =>
            executor.heartbeat(brain, id).pipe(Effect.tap(() => Ref.update(heartbeats, (count) => count + 1))),
          output: (brain, id, cursor) =>
            executor.output(brain, id, cursor).pipe(
              Effect.map((events) =>
                events.pipe(
                  Stream.onStart(Ref.update(outputsOpen, (count) => count + 1)),
                  Stream.ensuring(Ref.update(outputsOpen, (count) => count - 1)),
                  Stream.tap((event) =>
                    event.type === "ping" ? Ref.update(pings, (count) => count + 1) : Effect.void,
                  ),
                ),
              ),
            ),
        }),
      ),
    ).pipe(Layer.provide(Sandbox.layer))
    return { heartbeats, pings, spawns, outputsOpen, layer } satisfies Probe
  })

export const start = (options: Parameters<typeof TestHand.layer>[0]) =>
  Layer.build(Layer.fresh(TestHand.layer(options))).pipe(
    Effect.flatMap((context) => Effect.provide(TestHand.url, context)),
  )

const letSocketsRun = Effect.promise(() => Bun.sleep(2))

export const advance = (duration: Duration.Duration) =>
  Effect.forEach(
    Array.from({ length: Math.ceil(Duration.toSeconds(duration)) }),
    () => TestClock.adjust(Duration.seconds(1)).pipe(Effect.andThen(letSocketsRun)),
    { discard: true },
  )

export const advanceUntil = <E, R>(condition: Effect.Effect<boolean, E, R>, limit = Duration.minutes(30)) =>
  Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis
    yield* condition.pipe(
      Effect.flatMap((isDone) =>
        isDone
          ? Effect.succeed(true)
          : Clock.currentTimeMillis.pipe(
              Effect.flatMap((now) =>
                now - started > Duration.toMillis(limit)
                  ? Effect.die(new Error(`The condition did not hold within ${Duration.format(limit)}`))
                  : advance(Duration.seconds(1)).pipe(Effect.as(false)),
              ),
            ),
      ),
      Effect.repeat({ until: (isDone) => isDone }),
    )
  })

export interface Request {
  readonly rpc: string
  readonly atMs: number
  readonly refused: boolean
}

interface Link {
  readonly layer: Layer.Layer<HttpClient.HttpClient>
  readonly down: Ref.Ref<boolean>
  readonly requests: Ref.Ref<ReadonlyArray<Request>>
}

const rpcName = (body: { readonly _tag: string }) =>
  "body" in body && body.body instanceof Uint8Array
    ? (/"tag":"([\w.]+)"/.exec(new TextDecoder().decode(body.body))?.[1] ?? "unknown")
    : "unknown"

export const link = Effect.gen(function* () {
  const down = yield* Ref.make(false)
  const requests = yield* Ref.make<ReadonlyArray<Request>>([])
  const layer = Layer.effect(
    HttpClient.HttpClient,
    Effect.map(HttpClient.HttpClient, (client) =>
      HttpClient.mapRequestEffect(client, (request) =>
        Effect.gen(function* () {
          const refused = yield* Ref.get(down)
          const atMs = yield* Clock.currentTimeMillis
          yield* Ref.update(requests, (all) => [...all, { rpc: rpcName(request.body), atMs, refused }])
          if (refused)
            return yield* new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({ request, description: "the link is down" }),
            })
          return request
        }),
      ),
    ),
  ).pipe(Layer.provide(FetchHttpClient.layer))
  return { layer, down, requests } satisfies Link
})
