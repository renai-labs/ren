export * as BrainHost from "./brain-host.js"

import { BrainApi } from "@ren/brain-api/brain-api"
import type { BrainRejectedError, SessionNotStartedError } from "@ren/brain-api/errors"
import { CellToken } from "@ren/schema/cell-token"
import { Session } from "@ren/schema/session"
import {
  Array,
  type Cause,
  Clock,
  Config,
  Context,
  DateTime,
  Effect,
  Layer,
  Redacted,
  Schedule,
  Schema,
  Struct,
} from "effect"
import { Base64Url } from "effect/encoding"
import { HttpClient, HttpClientError, HttpClientRequest } from "effect/http"
import { HttpApiClient } from "effect/http-api"

export { BrainRejectedError, SessionNotStartedError } from "@ren/brain-api/errors"

export class BrainUnavailable extends Schema.TaggedError<BrainUnavailable>()("BrainUnavailable", {
  cause: Schema.Defect(),
}) {}

export interface Interface {
  readonly start: (input: Session.StartInput) => Effect.Effect<Session.Started, BrainUnavailable | BrainRejectedError>
  readonly send: (
    input: Session.SendInput,
  ) => Effect.Effect<Session.Accepted, BrainUnavailable | BrainRejectedError | SessionNotStartedError>
  readonly access: (sessionId: Session.ID) => Effect.Effect<Session.ClientAccess>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/BrainHost") {}

const limit = "30 seconds"
const serverLifetime = 5 * 60
const clientLifetime = 60 * 60
const transient = new Set([408, 429, 500, 502, 503, 504])

const sign = (key: CellToken.Key, claims: Omit<CellToken.Payload, "kid">) => {
  const payload = Base64Url.encode(JSON.stringify({ kid: key.id, ...claims }))
  return `${payload}.${Base64Url.encode(new Bun.CryptoHasher("sha256", key.secret).update(payload).digest())}`
}

const unavailable = (error: HttpClientError.HttpClientError) =>
  error.reason._tag === "TransportError" || ("response" in error.reason && transient.has(error.reason.response.status))

const failures = {
  TimeoutError: (cause: Cause.TimeoutError) => Effect.fail(new BrainUnavailable({ cause })),
  HttpClientError: (cause: HttpClientError.HttpClientError) =>
    unavailable(cause) ? Effect.fail(new BrainUnavailable({ cause })) : Effect.die(cause),
  ForbiddenError: Effect.die,
  SchemaError: Effect.die,
}

export const layerCelld = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.all({
      url: Config.URL("CELL_URL"),
      keys: Config.schema(Schema.RedactedFromValue(CellToken.Keys), "CELL_KEYS"),
    })
    const url = config.url.origin
    const key = Array.headNonEmpty(Redacted.value(config.keys))
    const http = yield* HttpClient.HttpClient

    const client = Effect.fnUntraced(function* (sessionId: Session.ID) {
      const now = yield* Clock.currentTimeMillis
      const token = sign(key, { sid: sessionId, scope: "server", exp: Math.floor(now / 1000) + serverLifetime })
      return yield* HttpApiClient.makeWith(BrainApi, {
        baseUrl: url,
        httpClient: HttpClient.mapRequest(http, HttpClientRequest.basicAuth("ren", token)),
      })
    })

    return Service.of({
      start: Effect.fn("BrainHost.start")(function* (input: Session.StartInput) {
        const brain = yield* client(input.sessionId)
        return yield* brain.brain["brain.start"]({ payload: input }).pipe(
          Effect.retry({
            while: (error) => HttpClientError.isHttpClientError(error) && unavailable(error),
            schedule: Schedule.exponential("200 millis"),
            times: 3,
          }),
          Effect.timeout(limit),
          Effect.catchTags(failures),
        )
      }),
      send: Effect.fn("BrainHost.send")(function* (input: Session.SendInput) {
        const brain = yield* client(input.sessionId)
        return yield* brain.brain["brain.send"]({
          params: { id: input.sessionId },
          payload: Struct.omit(input, ["sessionId"]),
        }).pipe(Effect.timeout(limit), Effect.catchTags(failures))
      }),
      access: Effect.fn("BrainHost.access")(function* (sessionId: Session.ID) {
        const exp = Math.floor((yield* Clock.currentTimeMillis) / 1000) + clientLifetime
        return {
          url,
          token: sign(key, { sid: sessionId, scope: "client", exp }),
          expiresAt: DateTime.makeUnsafe(exp * 1000),
        } satisfies Session.ClientAccess
      }),
    })
  }),
)
