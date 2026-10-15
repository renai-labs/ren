export * as BrainHost from "./brain-host.js"

import { BrainApi, type ModelsBody } from "@ren/brain-api/brain-api"
import {
  BrainRejectedError,
  ForbiddenError,
  type ModelsNotConfiguredError,
  ModelsUnavailableError,
  type SessionNotStartedError,
} from "@ren/brain-api/errors"
import { SessionToken } from "@ren/brain-api/session-token"
import type { Auth } from "@ren/schema/auth"
import { Session } from "@ren/schema/session"
import {
  Array,
  ByteSize,
  Cause,
  Clock,
  Config,
  Context,
  DateTime,
  Effect,
  Layer,
  Option,
  Redacted,
  Schedule,
  Schema,
  Struct,
} from "effect"
import { HttpClient, HttpClientError, HttpClientRequest } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { Models } from "./models.js"

export {
  BrainRejectedError,
  ForbiddenError,
  ModelsUnavailableError,
  SessionNotStartedError,
} from "@ren/brain-api/errors"

export class BrainUnavailable extends Schema.TaggedError<BrainUnavailable>()("BrainUnavailable", {
  cause: Schema.Defect(),
}) {}

export interface Interface {
  readonly start: (
    input: Session.StartInput,
    organizationId: Auth.OrganizationID,
  ) => Effect.Effect<Session.Started, BrainUnavailable | BrainRejectedError>
  readonly send: (
    input: Session.SendInput,
    organizationId: Auth.OrganizationID,
  ) => Effect.Effect<Session.Accepted, BrainUnavailable | BrainRejectedError | SessionNotStartedError>
  readonly access: (sessionId: Session.ID) => Effect.Effect<Session.ClientAccess>
  readonly revokeModels: (
    sessionId: Session.ID,
    organizationId: Auth.OrganizationID,
  ) => Effect.Effect<void, BrainUnavailable | BrainRejectedError>
  readonly refreshModels: (hostToken: string) => Effect.Effect<ModelsBody, ForbiddenError | ModelsUnavailableError>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/BrainHost") {}

class Target extends Context.Service<Target, Session.ID>()("@ren/core/BrainHost/Target") {}

const limit = "30 seconds"
const serverLifetime = 5 * 60
const clientLifetime = 60 * 60
const hostTokenLifetime = 2 * 60 * 60
const transient = new Set([408, 429, 500, 502, 503, 504])

const unavailable = (error: HttpClientError.HttpClientError) =>
  error.reason._tag === "TransportError" || ("response" in error.reason && transient.has(error.reason.response.status))

type Failure = Cause.TimeoutError | HttpClientError.HttpClientError | Schema.SchemaError | ForbiddenError

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.all({
      url: Config.URL("CELL_URL"),
      keys: Config.schema(Schema.RedactedFromValue(SessionToken.Keys), "CELL_KEYS"),
      maxFileSize: Config.ByteSize("BRAIN_MAX_FILE_SIZE").pipe(Config.withDefault(ByteSize.megabytes(10))),
    })
    const url = config.url.origin
    const key = Array.headNonEmpty(Redacted.value(config.keys))
    const http = yield* HttpClient.HttpClient
    const models = yield* Models.Service
    const brain = yield* HttpApiClient.makeWith(BrainApi, {
      baseUrl: url,
      httpClient: HttpClient.mapRequestEffect(http, (request) =>
        Effect.gen(function* () {
          const sid = yield* Target
          const exp = Math.floor((yield* Clock.currentTimeMillis) / 1000) + serverLifetime
          return HttpClientRequest.basicAuth(
            request,
            "ren",
            yield* SessionToken.sign(key, { sid, scope: "server", exp }),
          )
        }),
      ),
    })

    const call = <A, E>(
      sessionId: Session.ID,
      effect: Effect.Effect<A, E | HttpClientError.HttpClientError | Schema.SchemaError | ForbiddenError, Target>,
    ) =>
      effect.pipe(
        Effect.provideService(Target, sessionId),
        Effect.retry({
          while: (error) => HttpClientError.isHttpClientError(error) && unavailable(error),
          schedule: Schedule.exponential("200 millis"),
          times: 3,
        }),
        Effect.timeout(limit),
        Effect.catchIf(
          (error): error is Failure =>
            Cause.isTimeoutError(error) ||
            HttpClientError.isHttpClientError(error) ||
            Schema.isSchemaError(error) ||
            error instanceof ForbiddenError,
          (error): Effect.Effect<never, BrainRejectedError | BrainUnavailable> => {
            if (
              HttpClientError.isHttpClientError(error) &&
              "response" in error.reason &&
              error.reason.response.status === 413
            )
              return Effect.fail(
                new BrainRejectedError({ message: "The host rejected the request because its body is too large" }),
              )
            return Cause.isTimeoutError(error) || (HttpClientError.isHttpClientError(error) && unavailable(error))
              ? Effect.fail(new BrainUnavailable({ cause: error }))
              : Effect.die(error)
          },
        ),
      )

    const body = Effect.fnUntraced(function* (subject: Models.Subject, access: Models.Access) {
      const exp = Math.floor((yield* Clock.currentTimeMillis) / 1000) + hostTokenLifetime
      return {
        access,
        hostToken: yield* SessionToken.sign(key, {
          sid: subject.brainId,
          scope: "host",
          org: subject.organizationId,
          exp,
        }),
      } satisfies ModelsBody
    })

    const configure = (subject: Models.Subject, access: Models.Access) =>
      body(subject, access).pipe(
        Effect.flatMap((payload) => call(subject.brainId, brain.brain["brain.models"]({ payload }))),
      )

    const withModels = Effect.fnUntraced(function* <A, E>(
      subject: Models.Subject,
      request: Effect.Effect<A, E | ModelsNotConfiguredError>,
    ) {
      const refreshed = yield* models
        .refreshIfDue(subject)
        .pipe(
          Effect.catchTag("Models.Unavailable", (error) =>
            Effect.logWarning("Model access refresh failed; the brain keeps its current credentials", error).pipe(
              Effect.as(Option.none()),
            ),
          ),
        )
      if (Option.isSome(refreshed)) yield* configure(subject, refreshed.value)
      return yield* request.pipe(
        Effect.catchTag("ModelsNotConfiguredError", () =>
          models.grant(subject).pipe(
            Effect.mapError((cause) => new BrainUnavailable({ cause })),
            Effect.flatMap((access) => configure(subject, access)),
            Effect.andThen(request),
            Effect.catchTag("ModelsNotConfiguredError", Effect.die),
          ),
        ),
      )
    })

    const validatePrompt = Effect.fn("BrainHost.validatePrompt")(function* (prompt: Session.Prompt) {
      const large = prompt.files?.find((file) =>
        ByteSize.isGreaterThan(ByteSize.bytes(Session.fileBytes(file.url)), config.maxFileSize),
      )
      if (large)
        return yield* new BrainRejectedError({
          message: `${large.name ?? "A file"} is larger than ${ByteSize.format(config.maxFileSize, { system: "decimal" })}`,
        })
      if ((prompt.files ?? []).reduce((bytes, file) => bytes + Session.fileBytes(file.url), 0) > Session.maxFileBytes)
        return yield* new BrainRejectedError({ message: "A message’s files total more than 10 MB" })
    })

    return Service.of({
      start: Effect.fn("BrainHost.start")(function* (input: Session.StartInput, organizationId: Auth.OrganizationID) {
        if (input.initialMessage) yield* validatePrompt(input.initialMessage.prompt)
        return yield* withModels(
          { brainId: input.sessionId, organizationId },
          call(input.sessionId, brain.brain["brain.start"]({ payload: input })),
        )
      }),
      send: Effect.fn("BrainHost.send")(function* (input: Session.SendInput, organizationId: Auth.OrganizationID) {
        yield* validatePrompt(input.prompt)
        return yield* withModels(
          { brainId: input.sessionId, organizationId },
          call(
            input.sessionId,
            brain.brain["brain.send"]({ params: { id: input.sessionId }, payload: Struct.omit(input, ["sessionId"]) }),
          ),
        )
      }),
      revokeModels: Effect.fn("BrainHost.revokeModels")(function* (
        sessionId: Session.ID,
        organizationId: Auth.OrganizationID,
      ) {
        const cleared = yield* Effect.exit(call(sessionId, brain.brain["brain.removeModels"]()))
        yield* models
          .revoke({ brainId: sessionId, organizationId })
          .pipe(Effect.mapError((cause) => new BrainUnavailable({ cause })))
        return yield* cleared
      }),
      refreshModels: Effect.fn("BrainHost.refreshModels")(function* (hostToken: string) {
        const claims = yield* SessionToken.verify(Redacted.value(config.keys), hostToken)
        if (Option.isNone(claims) || claims.value.scope !== "host" || !claims.value.org)
          return yield* new ForbiddenError({ message: "The host token is not valid" })
        const subject = { brainId: claims.value.sid, organizationId: claims.value.org }
        const access = yield* models.grant(subject).pipe(
          Effect.tapError((error) => Effect.logWarning("Model access refresh failed", error)),
          Effect.mapError(() => new ModelsUnavailableError({ message: "Model access is unavailable" })),
        )
        return yield* body(subject, access)
      }),
      access: Effect.fn("BrainHost.access")(function* (sessionId: Session.ID) {
        const exp = Math.floor((yield* Clock.currentTimeMillis) / 1000) + clientLifetime
        return {
          url,
          token: yield* SessionToken.sign(key, { sid: sessionId, scope: "client", exp }),
          expiresAt: DateTime.makeUnsafe(exp * 1000),
        } satisfies Session.ClientAccess
      }),
    })
  }),
)
