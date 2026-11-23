export * as ChatAccess from "./chat-access.js"

import { ClientError, Ren } from "@ren/client/chat/effect"
import type { Session } from "@ren/schema/session"
import { Clock, Data, DateTime, Effect, Option, Semaphore, SubscriptionRef } from "effect"
import { HttpClient, HttpClientError, HttpClientRequest } from "effect/http"
import { Connection } from "./connection.js"

export const startingPollMs = 2_000
const headersTimeout = "60 seconds"
const refreshBefore = 60_000

// oxlint-disable-next-line ren/no-comments -- The sandbox provider's proxy answers 502 or 504 when it cannot reach the sandbox, for example after the sandbox was killed (E123).
const gateway = new Set([502, 504])

const httpErrorOf = (error: unknown) =>
  error instanceof ClientError && HttpClientError.isHttpClientError(error.cause)
    ? Option.some(error.cause)
    : Option.none()

export const isUnauthorized = (error: unknown) =>
  Option.exists(httpErrorOf(error), (cause) => "response" in cause.reason && cause.reason.response.status === 401)

// oxlint-disable-next-line ren/no-comments -- The brain did not answer, its sandbox is gone, or it refused a token of an old generation: the message stays pending and is sent again with the same id after new access; the brain skips an id it has (E126).
export const isUnreachable = (error: unknown) =>
  isUnauthorized(error) ||
  Option.exists(
    httpErrorOf(error),
    (cause) =>
      cause.reason._tag === "TransportError" ||
      ("response" in cause.reason && gateway.has(cause.reason.response.status)),
  )

export class AccessFailed extends Data.TaggedError("ChatAccess.AccessFailed")<{ readonly cause: unknown }> {}

export type Boot =
  | { readonly _tag: "Checking" }
  | { readonly _tag: "Ready" }
  | { readonly _tag: "Starting"; readonly phase: string }
  | { readonly _tag: "Failed"; readonly reason: string }
  | { readonly _tag: "Stopped" }

export type Client = Effect.Success<ReturnType<typeof Ren.make>>

export interface Options {
  readonly access: (input: { readonly unreachable: boolean }) => Effect.Effect<Session.ClientAccess, unknown>
  // oxlint-disable-next-line ren/no-comments -- Runs each time Ren answers that the brain is not ready (starting, failed or stopped).
  readonly waiting?: Effect.Effect<void>
}

export const make = Effect.fnUntraced(function* (options: Options) {
  const http = yield* HttpClient.HttpClient
  const boot = yield* SubscriptionRef.make<Boot>({ _tag: "Checking" })
  const lock = yield* Semaphore.make(1)
  const cached: { current: Option.Option<{ readonly access: Session.ReadyAccess; readonly client: Client }> } = {
    current: Option.none(),
  }
  // oxlint-disable-next-line ren/no-comments -- A request to the brain's URL that got no answer: the next access asks Ren to check the sandbox (E123).
  const reach = { unreachable: false }
  const waiting = options.waiting ?? Effect.void

  const lost = Effect.sync(() => {
    reach.unreachable = true
    cached.current = Option.none()
  })

  const forget = Effect.sync(() => {
    cached.current = Option.none()
  })

  const client = lock.withPermits(1)(
    Effect.gen(function* () {
      const currentBoot = yield* SubscriptionRef.get(boot)
      if (currentBoot._tag === "Failed") return yield* new AccessFailed({ cause: new Error(currentBoot.reason) })
      if (currentBoot._tag === "Stopped")
        return yield* new AccessFailed({ cause: new Error("The space was shut down") })
      const now = yield* Clock.currentTimeMillis
      if (
        Option.isSome(cached.current) &&
        DateTime.toEpochMillis(cached.current.value.access.expiresAt) - now > refreshBefore
      )
        return cached.current.value.client
      const unreachable = reach.unreachable
      reach.unreachable = false
      const access = yield* options.access({ unreachable }).pipe(
        Effect.mapError((cause) => new AccessFailed({ cause })),
        Effect.flatMap((answer) => {
          if (answer.status === "ready")
            return SubscriptionRef.set(boot, { _tag: "Ready" }).pipe(Effect.as(Option.some(answer)))
          if (answer.status === "failed")
            return SubscriptionRef.set(boot, { _tag: "Failed", reason: answer.reason }).pipe(
              Effect.andThen(waiting),
              Effect.andThen(Effect.fail(new AccessFailed({ cause: new Error(answer.reason) }))),
            )
          if (answer.status === "stopped")
            return SubscriptionRef.set(boot, { _tag: "Stopped" }).pipe(
              Effect.andThen(waiting),
              Effect.andThen(Effect.fail(new AccessFailed({ cause: new Error("The space was shut down") }))),
            )
          return SubscriptionRef.set(boot, { _tag: "Starting", phase: answer.phase }).pipe(
            Effect.andThen(waiting),
            Effect.andThen(Effect.sleep(startingPollMs)),
            Effect.as(Option.none<Session.ReadyAccess>()),
          )
        }),
        Effect.repeat({ until: Option.isSome }),
        Effect.flatMap((answer) =>
          Option.match(answer, {
            onNone: () => Effect.fail(new AccessFailed({ cause: new Error("The brain did not start") })),
            onSome: Effect.succeed,
          }),
        ),
      )
      const authorized = HttpClient.mapRequest(http, HttpClientRequest.basicAuth("ren", access.token)).pipe(
        HttpClient.transform((response, request) =>
          response.pipe(
            Effect.tap((answer) => (gateway.has(answer.status) ? lost : Effect.void)),
            Effect.tapError((error) => (error.reason._tag === "TransportError" ? lost : Effect.void)),
            Effect.provideService(HttpClient.TracerPropagationEnabled, false),
            Effect.timeoutOrElse({
              duration: headersTimeout,
              orElse: () =>
                Effect.fail(
                  new HttpClientError.HttpClientError({
                    reason: new HttpClientError.TransportError({
                      request,
                      description: "Timed out waiting for the session to respond",
                    }),
                  }),
                ),
            }),
          ),
        ),
      )
      const made = yield* Ren.make({ baseUrl: access.url }).pipe(
        Effect.provideService(HttpClient.HttpClient, authorized),
      )
      cached.current = Option.some({ access, client: made })
      return made
    }),
  )

  return { boot, client, lost, forget }
})

export type ChatAccess = Effect.Success<ReturnType<typeof make>>

export const connect = (
  access: ChatAccess,
  options: Omit<Connection.Options, "subscribe" | "canReconnect" | "onUnreachable" | "onStatus"> & {
    readonly onStatus?: (status: Connection.Status) => Effect.Effect<void>
  },
) =>
  Connection.make({
    ...options,
    subscribe: Effect.map(access.client, (api) => api.event.subscribe()),
    canReconnect: Effect.map(
      SubscriptionRef.get(access.boot),
      (current) => current._tag !== "Failed" && current._tag !== "Stopped",
    ),
    onUnreachable: access.lost,
    onStatus: (next) =>
      // oxlint-disable-next-line ren/no-comments -- A parked brain may be asleep or gone: the next read or send asks Ren first, which wakes it (E128).
      (next === "reconnecting" || next === "parked" ? access.forget : Effect.void).pipe(
        Effect.andThen(options.onStatus?.(next) ?? Effect.void),
      ),
  })
