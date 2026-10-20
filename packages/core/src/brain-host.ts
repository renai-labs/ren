export * as BrainHost from "./brain-host.js"

import { BrainApi, type StartBody } from "@ren/host-api/brain-api"
import {
  BrainRejectedError,
  EnvironmentNotFoundError,
  EnvironmentUnavailableError,
  ForbiddenError,
  type ModelsNotConfiguredError,
  ModelsUnavailableError,
  type SessionNotStartedError,
} from "@ren/host-api/errors"
import { SessionToken } from "@ren/host-api/session-token"
import type { Auth } from "@ren/schema/auth"
import type { Brain } from "@ren/schema/brain"
import type { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import {
  Array,
  ByteSize,
  Cause,
  Clock,
  Config,
  Context,
  DateTime,
  Duration,
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
import type { Host } from "@ren/host-api/host"
import { CurrentHost, HostAuthentication } from "@ren/host-api/ren-host-api"
import { Environments } from "./environments.js"
import { Models } from "./models.js"

export {
  BrainRejectedError,
  EnvironmentNotFoundError,
  EnvironmentUnavailableError,
  ForbiddenError,
  ModelsUnavailableError,
  SessionNotStartedError,
} from "@ren/host-api/errors"

export class BrainUnavailable extends Schema.TaggedError<BrainUnavailable>()("BrainUnavailable", {
  cause: Schema.Defect(),
}) {}

export interface Interface {
  readonly start: (
    input: Session.StartInput,
    placement: Environments.Placement,
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
  readonly authenticateHost: (hostToken: Redacted.Redacted) => Effect.Effect<CurrentHost["Service"], ForbiddenError>
  readonly refreshModels: (host: CurrentHost["Service"]) => Effect.Effect<Brain.ModelGrant, ModelsUnavailableError>
  readonly refreshHostToken: (host: CurrentHost["Service"]) => Effect.Effect<Host.Refreshed>
  readonly accessEnvironment: (
    host: CurrentHost["Service"],
  ) => Effect.Effect<Environment.Access, EnvironmentNotFoundError | EnvironmentUnavailableError>
  readonly releaseEnvironment: (host: CurrentHost["Service"]) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/BrainHost") {}

class Target extends Context.Service<Target, Session.ID>()("@ren/core/BrainHost/Target") {}

const limit = "30 seconds"
const serverLifetime = 5 * 60
const clientLifetime = 60 * 60
const hostTokenLifetime = Duration.hours(2)
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
    const environments = yield* Environments.Service
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

    const hostToken = Effect.fnUntraced(function* (subject: Models.Subject, exp: number) {
      return yield* SessionToken.sign(key, {
        sid: subject.sessionId,
        scope: "host",
        org: subject.organizationId,
        iat: Math.floor((yield* Clock.currentTimeMillis) / 1000),
        exp,
      })
    })

    const body = Effect.fnUntraced(function* (subject: Models.Subject, access: Models.Access) {
      const lastExpiry = access.endpoints.reduce(
        (latest, endpoint) => (endpoint.apiKey.expiresAt ? DateTime.max(latest, endpoint.apiKey.expiresAt) : latest),
        yield* DateTime.now,
      )
      const exp = Math.floor(DateTime.toEpochMillis(DateTime.addDuration(lastExpiry, hostTokenLifetime)) / 1000)
      return { access, hostToken: Redacted.make(yield* hostToken(subject, exp)) } satisfies Brain.ModelGrant
    })

    const configure = (subject: Models.Subject, access: Models.Access) =>
      body(subject, access).pipe(
        Effect.flatMap((payload) => call(subject.sessionId, brain.brain["brain.configureModels"]({ payload }))),
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
            Effect.catchTag("ModelsNotConfiguredError", (cause) => Effect.fail(new BrainUnavailable({ cause }))),
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
      start: Effect.fn("BrainHost.start")(function* (input: Session.StartInput, placement: Environments.Placement) {
        if (input.initialMessage) yield* validatePrompt(input.initialMessage.prompt)
        const subject = { sessionId: input.sessionId, organizationId: placement.organizationId }
        const requested = input.environmentTemplateId
        const binding = requested
          ? Option.some(
              yield* environments
                .bind({ ...subject, spaceId: placement.spaceId }, requested)
                .pipe(Effect.mapError((error) => new BrainRejectedError({ message: error.message }))),
            )
          : Option.map(yield* environments.findDirectory(subject), (directory) => ({ directory, isNew: false }))
        const payload = {
          ...Struct.omit(input, ["environmentTemplateId"]),
          ...Option.match(binding, { onNone: () => ({}), onSome: (found) => ({ directory: found.directory }) }),
        } satisfies StartBody
        return yield* withModels(subject, call(input.sessionId, brain.brain["brain.start"]({ payload }))).pipe(
          Effect.tapErrorTag("BrainRejectedError", () =>
            Option.exists(binding, (found) => found.isNew) ? environments.unbind(subject) : Effect.void,
          ),
        )
      }),
      send: Effect.fn("BrainHost.send")(function* (input: Session.SendInput, organizationId: Auth.OrganizationID) {
        yield* validatePrompt(input.prompt)
        return yield* withModels(
          { sessionId: input.sessionId, organizationId },
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
          .revoke({ sessionId, organizationId })
          .pipe(Effect.mapError((cause) => new BrainUnavailable({ cause })))
        return yield* cleared
      }),
      authenticateHost: Effect.fn("BrainHost.authenticateHost")(function* (hostToken: Redacted.Redacted) {
        const claims = yield* SessionToken.verify(Redacted.value(config.keys), Redacted.value(hostToken))
        if (Option.isNone(claims) || claims.value.scope !== "host")
          return yield* new ForbiddenError({ message: "The host token is not valid" })
        return { sessionId: claims.value.sid, organizationId: claims.value.org }
      }),
      refreshModels: Effect.fn("BrainHost.refreshModels")(function* (host: CurrentHost["Service"]) {
        const access = yield* models.grant(host).pipe(
          Effect.tapError((error) => Effect.logWarning("Model access refresh failed", error)),
          Effect.mapError(() => new ModelsUnavailableError({ message: "Model access is unavailable" })),
        )
        return yield* body(host, access)
      }),
      refreshHostToken: Effect.fn("BrainHost.refreshHostToken")(function* (host: CurrentHost["Service"]) {
        const exp = Math.floor(
          DateTime.toEpochMillis(DateTime.addDuration(yield* DateTime.now, hostTokenLifetime)) / 1000,
        )
        return { hostToken: Redacted.make(yield* hostToken(host, exp)) }
      }),
      accessEnvironment: Effect.fn("BrainHost.accessEnvironment")(function* (host: CurrentHost["Service"]) {
        return yield* environments.access(host).pipe(
          Effect.catchTags({
            "Environments.NotFound": (error) => Effect.fail(new EnvironmentNotFoundError({ message: error.message })),
            "Environments.Unavailable": (error) =>
              Effect.fail(new EnvironmentUnavailableError({ message: error.message })),
          }),
        )
      }),
      releaseEnvironment: Effect.fn("BrainHost.releaseEnvironment")(function* (host: CurrentHost["Service"]) {
        yield* environments.release(host)
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

export const hostAuthentication = Layer.effect(
  HostAuthentication,
  Effect.gen(function* () {
    const brain = yield* Service
    return HostAuthentication.of({
      bearer: Effect.fn("BrainHost.hostAuthentication")(function* (httpEffect, options) {
        const host = yield* brain.authenticateHost(options.credential)
        return yield* httpEffect.pipe(Effect.provideService(CurrentHost, host))
      }),
    })
  }),
)
