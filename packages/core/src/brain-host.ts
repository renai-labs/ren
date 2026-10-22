export * as BrainHost from "./brain-host.js"

import { Database } from "@ren/db/database"
import type { StartBody, Synced } from "@ren/host-api/brain-api"
import {
  BrainRejectedError,
  EnvironmentNotFoundError,
  EnvironmentUnavailableError,
  ForbiddenError,
  GenerationRetiredError,
  ModelsNotConfiguredError,
  ModelsUnavailableError,
  type SessionNotStartedError,
  SyncUnavailableError,
  UnauthorizedError,
} from "@ren/host-api/errors"
import type { Host } from "@ren/host-api/host"
import { CurrentHost, HostAuthentication, type PullReply, type PullRequest } from "@ren/host-api/ren-host-api"
import type { Auth } from "@ren/schema/auth"
import type { Brain } from "@ren/schema/brain"
import type { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { and, eq } from "drizzle-orm"
import {
  ByteSize,
  Cause,
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
import { HttpClientError } from "effect/http"
import { BrainClient } from "./brain-client.js"
import { BrainLifecycle } from "./brain-lifecycle.js"
import { DurableRunner } from "./durable-runner.js"
import { Environments } from "./environments.js"
import { Models } from "./models.js"
import { Settings } from "./settings.js"

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

export interface Placement {
  readonly organizationId: Auth.OrganizationID
  readonly spaceId: Space.ID
  readonly brainId: Brain.ID
}

export interface Interface {
  readonly start: (input: Session.StartInput, placement: Placement) => Effect.Effect<void, BrainRejectedError>
  readonly send: (
    input: Session.SendInput,
  ) => Effect.Effect<Session.Accepted, BrainUnavailable | BrainRejectedError | SessionNotStartedError>
  readonly access: (
    sessionId: Session.ID,
    member: { readonly userId: Auth.UserID; readonly name?: string },
  ) => Effect.Effect<Session.ClientAccess>
  readonly prepare: (spaceId: Space.ID) => Effect.Effect<void>
  readonly flush: (sessionId: Session.ID) => Effect.Effect<Synced, BrainUnavailable | BrainRejectedError>
  readonly authenticateHost: (
    hostToken: Redacted.Redacted,
  ) => Effect.Effect<CurrentHost["Service"], UnauthorizedError | ForbiddenError | GenerationRetiredError>
  readonly pull: (host: CurrentHost["Service"], request: PullRequest) => Effect.Effect<PullReply, ForbiddenError>
  readonly refreshModels: (host: CurrentHost["Service"]) => Effect.Effect<Brain.ModelGrant, ModelsUnavailableError>
  readonly refreshHostToken: (host: CurrentHost["Service"]) => Effect.Effect<Host.Refreshed>
  readonly accessEnvironment: (
    host: CurrentHost["Service"],
    sessionId: Session.ID,
  ) => Effect.Effect<Environment.Access, EnvironmentNotFoundError | EnvironmentUnavailableError | ForbiddenError>
  readonly releaseEnvironment: (
    host: CurrentHost["Service"],
    sessionId: Session.ID,
  ) => Effect.Effect<void, ForbiddenError>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/BrainHost") {}

const limit = "30 seconds"
const transient = new Set([408, 429, 500, 502, 503, 504])

const unavailable = (error: HttpClientError.HttpClientError) =>
  error.reason._tag === "TransportError" || ("response" in error.reason && transient.has(error.reason.response.status))

type Failure = Cause.TimeoutError | HttpClientError.HttpClientError | Schema.SchemaError | ForbiddenError

const call = <A, E>(
  effect: Effect.Effect<
    A,
    E | HttpClientError.HttpClientError | Schema.SchemaError | ForbiddenError | ModelsNotConfiguredError
  >,
) =>
  effect.pipe(
    Effect.retry({
      while: (error) =>
        error instanceof SyncUnavailableError ||
        error instanceof ModelsNotConfiguredError ||
        (HttpClientError.isHttpClientError(error) && unavailable(error)),
      schedule: Schedule.exponential("500 millis"),
      times: 4,
    }),
    Effect.timeout(limit),
    Effect.catchIf(
      (error): error is ModelsNotConfiguredError => error instanceof ModelsNotConfiguredError,
      (cause) => Effect.fail(new BrainUnavailable({ cause })),
    ),
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

interface Locator {
  readonly target: (brainId: Brain.ID) => Effect.Effect<BrainClient.Target, BrainUnavailable>
  readonly access: (brainId: Brain.ID) => Effect.Effect<BrainLifecycle.Access>
  readonly run: <E>(key: string, effect: Effect.Effect<void, E>) => Effect.Effect<void>
  readonly prepare: (brainId: Brain.ID) => Effect.Effect<void>
  readonly observe: (brainId: Brain.ID, sessions: PullRequest["sessions"]) => Effect.Effect<void>
}

const make = Effect.fnUntraced(function* (locator: Locator) {
  const config = yield* Config.all({
    maxFileSize: Config.ByteSize("BRAIN_MAX_FILE_SIZE").pipe(Config.withDefault(ByteSize.megabytes(10))),
  })
  const database = yield* Database.Service
  const client = yield* BrainClient.Service
  const models = yield* Models.Service
  const settings = yield* Settings.Service
  const environments = yield* Environments.Service

  const brainOf = Effect.fnUntraced(function* (sessionId: Session.ID) {
    const row = (yield* database.db
      .select({
        brainId: Database.Schema.agent_session.brain_id,
        organizationId: Database.Schema.agent_session.organization_id,
        spaceId: Database.Schema.agent_session.space_id,
      })
      .from(Database.Schema.agent_session)
      .where(eq(Database.Schema.agent_session.id, sessionId))
      .pipe(Effect.orDie)).at(0)
    if (!row) return yield* Effect.die(new Error(`Session ${sessionId} does not exist`))
    return row
  })

  const inBrain = Effect.fnUntraced(function* (host: CurrentHost["Service"], sessionId: Session.ID) {
    const found = yield* database.db
      .select({ id: Database.Schema.agent_session.id })
      .from(Database.Schema.agent_session)
      .where(
        and(eq(Database.Schema.agent_session.id, sessionId), eq(Database.Schema.agent_session.brain_id, host.brainId)),
      )
      .pipe(Effect.orDie)
    if (found.length === 0)
      return yield* new ForbiddenError({ message: `Session ${sessionId} is not on brain ${host.brainId}` })
    return { sessionId, organizationId: host.organizationId }
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

  const startNow = Effect.fn("BrainHost.startNow")(function* (input: Session.StartInput, placement: Placement) {
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
    const target = yield* locator.target(placement.brainId)
    const api = yield* client.brain(target)
    yield* call(api.brain["brain.start"]({ payload })).pipe(
      Effect.catchTag("SyncUnavailableError", (cause) => Effect.fail(new BrainUnavailable({ cause }))),
      Effect.tapErrorTag("BrainRejectedError", () =>
        Option.exists(binding, (found) => found.isNew) ? environments.unbind(subject) : Effect.void,
      ),
    )
  })

  const spaceBrain = (spaceId: Space.ID) =>
    database.db
      .select({ id: Database.Schema.brain.id })
      .from(Database.Schema.brain)
      .where(and(eq(Database.Schema.brain.space_id, spaceId), eq(Database.Schema.brain.scope, "space")))
      .pipe(
        Effect.orDie,
        Effect.map((rows) => Option.fromNullishOr(rows.at(0)?.id)),
      )

  return Service.of({
    start: Effect.fn("BrainHost.start")(function* (input: Session.StartInput, placement: Placement) {
      if (input.initialMessage) yield* validatePrompt(input.initialMessage.prompt)
      yield* locator.run(
        `start:${input.sessionId}`,
        startNow(input, placement).pipe(
          Effect.catchTag("BrainRejectedError", (error) =>
            Effect.logError(`The brain rejected the start of ${input.sessionId}: ${error.message}`),
          ),
          Effect.catchTag("BrainUnavailable", (error) =>
            Effect.logWarning(`The brain of ${input.sessionId} is unavailable; the start retries`).pipe(
              Effect.andThen(Effect.fail(error)),
            ),
          ),
        ),
      )
    }),
    send: Effect.fn("BrainHost.send")(function* (input: Session.SendInput) {
      yield* validatePrompt(input.prompt)
      const session = yield* brainOf(input.sessionId)
      const target = yield* locator.target(session.brainId)
      const api = yield* client.brain(target)
      return yield* call(
        api.brain["brain.send"]({ params: { id: input.sessionId }, payload: Struct.omit(input, ["sessionId"]) }),
      )
    }),
    access: Effect.fn("BrainHost.access")(function* (
      sessionId: Session.ID,
      member: { readonly userId: Auth.UserID; readonly name?: string },
    ) {
      const session = yield* brainOf(sessionId)
      const state = yield* locator.access(session.brainId)
      if (state._tag === "Starting") return { status: "starting", phase: state.phase } satisfies Session.ClientAccess
      if (state._tag === "Failed") return { status: "failed", reason: state.reason } satisfies Session.ClientAccess
      const signed = yield* client.clientToken(state.target, {
        sid: sessionId,
        sub: member.userId,
        ...(member.name && { name: member.name }),
      })
      return {
        status: "ready",
        url: state.target.url,
        token: signed.token,
        expiresAt: DateTime.makeUnsafe(signed.exp * 1000),
      } satisfies Session.ClientAccess
    }),
    prepare: Effect.fn("BrainHost.prepare")(function* (spaceId: Space.ID) {
      const brain = yield* spaceBrain(spaceId)
      if (Option.isSome(brain)) yield* locator.prepare(brain.value)
    }),
    flush: Effect.fn("BrainHost.flush")(function* (sessionId: Session.ID) {
      const session = yield* brainOf(sessionId)
      const target = yield* locator.target(session.brainId)
      const api = yield* client.brain(target)
      return yield* call(api.brain["brain.sync"]())
    }),
    authenticateHost: Effect.fn("BrainHost.authenticateHost")(function* (hostToken: Redacted.Redacted) {
      const claims = yield* client.verify(Redacted.value(hostToken))
      if (Option.isNone(claims) || claims.value.scope !== "host")
        return yield* new UnauthorizedError({ message: "The host token is not valid" })
      const brain = (yield* database.db
        .select({ organizationId: Database.Schema.brain.organization_id, generation: Database.Schema.brain.generation })
        .from(Database.Schema.brain)
        .where(eq(Database.Schema.brain.id, claims.value.brain))
        .pipe(Effect.orDie)).at(0)
      if (!brain || brain.organizationId !== claims.value.org)
        return yield* new ForbiddenError({ message: "The host token names no brain of its organization" })
      if (brain.generation !== claims.value.gen)
        return yield* new GenerationRetiredError({
          message: `Generation ${claims.value.gen} of brain ${claims.value.brain} is retired`,
        })
      return { brainId: claims.value.brain, organizationId: claims.value.org, generation: claims.value.gen }
    }),
    pull: Effect.fn("BrainHost.pull")(function* (host: CurrentHost["Service"], request: PullRequest) {
      const pulled = yield* settings
        .pull(host.brainId, request.layers)
        .pipe(
          Effect.catchTag("Settings.NotFound", (error) => Effect.fail(new ForbiddenError({ message: error.message }))),
        )
      const access = yield* models.grant(host.brainId, host.organizationId).pipe(
        Effect.map(Option.some),
        Effect.catch((error) =>
          Effect.logWarning("Model access is unavailable for a pull; the brain keeps its models", error).pipe(
            Effect.as(Option.none<Models.Access>()),
          ),
        ),
      )
      yield* database.db
        .update(Database.Schema.brain)
        .set({ key_ids: [...request.keyIds] })
        .where(eq(Database.Schema.brain.id, host.brainId))
        .pipe(Effect.orDie)
      yield* locator.observe(host.brainId, request.sessions)
      const hash = Option.isSome(access) ? yield* Models.hash(access.value) : (request.models ?? "")
      return {
        publicKeys: client.publicKeys,
        models: Option.isNone(access) || hash === request.models ? { hash } : { hash, access: access.value },
        layers: pulled.layers,
        chats: pulled.chats,
      } satisfies PullReply
    }),
    refreshModels: Effect.fn("BrainHost.refreshModels")(function* (host: CurrentHost["Service"]) {
      const access = yield* models.grant(host.brainId, host.organizationId).pipe(
        Effect.tapError((error) => Effect.logWarning("Model access refresh failed", error)),
        Effect.mapError(() => new ModelsUnavailableError({ message: "Model access is unavailable" })),
      )
      return { access, hostToken: Redacted.make(yield* client.hostToken(host)) } satisfies Brain.ModelGrant
    }),
    refreshHostToken: Effect.fn("BrainHost.refreshHostToken")(function* (host: CurrentHost["Service"]) {
      return { hostToken: Redacted.make(yield* client.hostToken(host)) }
    }),
    accessEnvironment: Effect.fn("BrainHost.accessEnvironment")(function* (
      host: CurrentHost["Service"],
      sessionId: Session.ID,
    ) {
      const subject = yield* inBrain(host, sessionId)
      return yield* environments.access(subject).pipe(
        Effect.catchTags({
          "Environments.NotFound": (error) => Effect.fail(new EnvironmentNotFoundError({ message: error.message })),
          "Environments.Unavailable": (error) =>
            Effect.fail(new EnvironmentUnavailableError({ message: error.message })),
        }),
      )
    }),
    releaseEnvironment: Effect.fn("BrainHost.releaseEnvironment")(function* (
      host: CurrentHost["Service"],
      sessionId: Session.ID,
    ) {
      yield* environments.release(yield* inBrain(host, sessionId))
    }),
  })
})

const brainRow = (brainId: Brain.ID) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const row = (yield* database.db
      .select({
        organizationId: Database.Schema.brain.organization_id,
        generation: Database.Schema.brain.generation,
        keyIds: Database.Schema.brain.key_ids,
      })
      .from(Database.Schema.brain)
      .where(eq(Database.Schema.brain.id, brainId))
      .pipe(Effect.orDie)).at(0)
    if (!row) return yield* Effect.die(new Error(`Brain ${brainId} does not exist`))
    return row
  })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const url = (yield* Config.URL("CELL_URL")).origin
    const database = yield* Database.Service
    const target = (brainId: Brain.ID) =>
      brainRow(brainId).pipe(
        Effect.provideService(Database.Service, database),
        Effect.map((row) => ({
          brainId,
          generation: row.generation,
          organizationId: row.organizationId,
          url,
          keyIds: row.keyIds,
        })),
      )
    return yield* make({
      target,
      access: (brainId) => Effect.map(target(brainId), (found) => ({ _tag: "Ready", target: found }) as const),
      run: (_key, effect) => effect.pipe(Effect.ignore),
      prepare: () => Effect.void,
      observe: () => Effect.void,
    })
  }),
)

export const layerSandbox = Layer.effect(
  Service,
  Effect.gen(function* () {
    const lifecycle = yield* BrainLifecycle.Service
    const runner = yield* DurableRunner.Service
    const prepared = new Map<Brain.ID, number>()
    return yield* make({
      target: (brainId) => lifecycle.ready(brainId).pipe(Effect.mapError((cause) => new BrainUnavailable({ cause }))),
      access: lifecycle.access,
      run: runner.ensure,
      prepare: (brainId) =>
        Effect.gen(function* () {
          const now = Date.now()
          if (now - (prepared.get(brainId) ?? 0) < 5 * 60_000) return
          prepared.set(brainId, now)
          yield* lifecycle.ensure(brainId)
        }),
      observe: lifecycle.observe,
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
