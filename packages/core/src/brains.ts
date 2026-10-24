export * as Brains from "./brains.js"

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
import {
  CurrentHost,
  HostAuthentication,
  type PullApps,
  type PullReply,
  type PullRequest,
} from "@ren/host-api/ren-host-api"
import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import type { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { Space } from "@ren/schema/space"
import { and, eq, inArray, isNull } from "drizzle-orm"
import {
  ByteSize,
  Cause,
  Clock,
  Config,
  Context,
  DateTime,
  Effect,
  Layer,
  Option,
  Predicate,
  Redacted,
  Schedule,
  Schema,
  Struct,
} from "effect"
import { HttpClientError } from "effect/http"
import { WorkflowEngine } from "effect/workflow"
import { Access } from "./access.js"
import { AppResolve } from "./app/resolve.js"
import { BrainClient } from "./brain-client.js"
import { CredentialEnv } from "./credential-env.js"
import { BrainHost } from "./brain-host.js"
import { DurableRunner } from "./durable-runner.js"
import { Environments } from "./environments.js"
import { Models } from "./models.js"
import { Primitive } from "./primitive.js"
import { Settings } from "./settings.js"
import { SpacePolicy } from "./space/policy.js"
import { SpaceQueries } from "./space/queries.js"

export {
  BrainRejectedError,
  EnvironmentNotFoundError,
  EnvironmentUnavailableError,
  ForbiddenError,
  ModelsUnavailableError,
  SessionNotStartedError,
} from "@ren/host-api/errors"

export interface Placement {
  readonly organizationId: Auth.OrganizationID
  readonly spaceId: Space.ID
  readonly brainId: Brain.ID
}

export interface Interface {
  readonly start: (input: Session.StartInput, placement: Placement) => Effect.Effect<void, BrainRejectedError>
  readonly send: (
    input: Session.SendInput,
  ) => Effect.Effect<Session.Accepted, BrainHost.BrainUnavailable | BrainRejectedError | SessionNotStartedError>
  readonly access: (
    sessionId: Session.ID,
    member: { readonly userId: Auth.UserID; readonly name?: string },
    options?: { readonly unreachable?: boolean },
  ) => Effect.Effect<Session.ClientAccess>
  readonly prepare: (spaceId: Space.ID) => Effect.Effect<void>
  readonly flush: (sessionId: Session.ID) => Effect.Effect<Synced, BrainHost.BrainUnavailable | BrainRejectedError>
  readonly retry: (sessionId: Session.ID) => Effect.Effect<void>
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
  readonly directoryOf: (
    host: CurrentHost["Service"],
    sessionId: Session.ID,
  ) => Effect.Effect<Option.Option<Environment.Directory>, ForbiddenError>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Brains") {}

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
      (cause) => Effect.fail(new BrainHost.BrainUnavailable({ cause })),
    ),
    Effect.catchIf(
      (error): error is Failure =>
        Cause.isTimeoutError(error) ||
        HttpClientError.isHttpClientError(error) ||
        Schema.isSchemaError(error) ||
        error instanceof ForbiddenError,
      (error): Effect.Effect<never, BrainRejectedError | BrainHost.BrainUnavailable> => {
        if (
          HttpClientError.isHttpClientError(error) &&
          "response" in error.reason &&
          error.reason.response.status === 413
        )
          return Effect.fail(
            new BrainRejectedError({ message: "The host rejected the request because its body is too large" }),
          )
        return Cause.isTimeoutError(error) || (HttpClientError.isHttpClientError(error) && unavailable(error))
          ? Effect.fail(new BrainHost.BrainUnavailable({ cause: error }))
          : Effect.die(error)
      },
    ),
  )

// oxlint-disable-next-line ren/no-comments -- The brain's run counter is in the key: a start that gave up on a failed brain runs again after a Retry, because the failed brain run ended and the counter moved on.
export const StartRun = DurableRunner.make("StartRun", {
  payload: {
    input: Session.StartInput,
    placement: Schema.Struct({ organizationId: Auth.OrganizationID, spaceId: Space.ID, brainId: Brain.ID }),
    epoch: Schema.Int,
  },
  idempotencyKey: (payload) =>
    `start:${payload.input.sessionId}:${payload.input.initialMessage?.messageId ?? ""}:${payload.epoch}`,
})

const spaceGet = Primitive.action(Space.definition, "get")

const failedAsUnavailable = (cause: BrainHost.BrainFailed) => Effect.fail(new BrainHost.BrainUnavailable({ cause }))

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.all({
      maxFileSize: Config.ByteSize("BRAIN_MAX_FILE_SIZE").pipe(Config.withDefault(ByteSize.megabytes(10))),
    })
    const database = yield* Database.Service
    const access = yield* Access.Service
    const appResolve = yield* AppResolve.Service
    const client = yield* BrainClient.Service
    const models = yield* Models.Service
    const credentialEnv = yield* CredentialEnv.Service
    const settings = yield* Settings.Service
    const environments = yield* Environments.Service
    const brainHost = yield* BrainHost.Service
    const engine = yield* WorkflowEngine.WorkflowEngine
    const prepared = new Map<Brain.ID, number>()

    const brainRow = Effect.fnUntraced(function* (brainId: Brain.ID) {
      const row = (yield* database.db
        .select({ runEpoch: Database.Schema.brain.run_epoch })
        .from(Database.Schema.brain)
        .where(eq(Database.Schema.brain.id, brainId))
        .pipe(Effect.orDie)).at(0)
      if (!row) return yield* Effect.die(new Error(`Brain ${brainId} does not exist`))
      return row
    })

    const brainOf = Effect.fnUntraced(function* (sessionId: Session.ID) {
      const row = (yield* database.db
        .select({
          brainId: Database.Schema.agent_session.brain_id,
          organizationId: Database.Schema.agent_session.organization_id,
          spaceId: Database.Schema.agent_session.space_id,
          startedAt: Database.Schema.agent_session.started_at,
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
          and(
            eq(Database.Schema.agent_session.id, sessionId),
            eq(Database.Schema.agent_session.brain_id, host.brainId),
          ),
        )
        .pipe(Effect.orDie)
      if (found.length === 0)
        return yield* new ForbiddenError({ message: `Session ${sessionId} is not on brain ${host.brainId}` })
      return { sessionId, organizationId: host.organizationId }
    })

    const validatePrompt = Effect.fn("Brains.validatePrompt")(function* (prompt: Session.Prompt) {
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

    const handOf = Effect.fnUntraced(function* (brainId: Brain.ID, generation: number) {
      return Option.map(yield* brainHost.hand(brainId), (hand): Environments.Hand => ({
        brainId,
        generation,
        url: hand.url,
        workspace: hand.workspace,
      }))
    })

    const creatorSees = Effect.fnUntraced(function* (sessionId: Session.ID, placement: Placement) {
      return yield* database.transaction((transaction) =>
        Effect.gen(function* () {
          const createdBy = (yield* transaction
            .select({ userId: Database.Schema.agent_session.created_by })
            .from(Database.Schema.agent_session)
            .where(eq(Database.Schema.agent_session.id, sessionId))).at(0)?.userId
          if (!createdBy) return false
          const member = yield* SpaceQueries.organizationMember(transaction, placement.organizationId, createdBy)
          if (!member) return false
          const actor = { userId: createdBy, organizationId: placement.organizationId, roles: [member.role] }
          const visible = yield* transaction
            .select({ id: Database.Schema.space.id })
            .from(Database.Schema.space)
            .leftJoin(SpaceQueries.membership, SpaceQueries.membershipOf(actor))
            .where(
              and(
                eq(Database.Schema.space.id, placement.spaceId),
                eq(Database.Schema.space.organization_id, placement.organizationId),
                isNull(Database.Schema.space.archived_at),
                SpacePolicy.filter(access.plan(actor, spaceGet)),
              ),
            )
          return visible.length > 0
        }),
      )
    })

    const startNow = Effect.fn("Brains.startNow")(function* (input: Session.StartInput, placement: Placement) {
      const subject = { sessionId: input.sessionId, organizationId: placement.organizationId }
      if (!(yield* creatorSees(input.sessionId, placement)))
        return yield* new BrainRejectedError({
          message: `The creator of ${input.sessionId} can no longer see its space`,
        })
      const target = yield* brainHost.target(placement.brainId)
      const requested = input.environmentTemplateId
      const binding = requested
        ? Option.some(
            yield* environments
              .bind({ ...subject, spaceId: placement.spaceId }, requested)
              .pipe(Effect.mapError((error) => new BrainRejectedError({ message: error.message }))),
          )
        : Option.map(
            yield* environments.findDirectory(subject, yield* handOf(placement.brainId, target.generation)),
            (directory) => ({ directory, isNew: false }),
          )
      const payload = {
        ...Struct.omit(input, ["environmentTemplateId"]),
        ...Option.match(binding, { onNone: () => ({}), onSome: (found) => ({ directory: found.directory }) }),
      } satisfies StartBody
      const api = yield* client.brain(target)
      yield* call(api.brain["brain.start"]({ payload })).pipe(
        Effect.andThen(
          database.db
            .update(Database.Schema.agent_session)
            .set({ started_at: new Date() })
            .where(
              and(
                eq(Database.Schema.agent_session.id, input.sessionId),
                isNull(Database.Schema.agent_session.started_at),
              ),
            )
            .pipe(Effect.orDie),
        ),
        Effect.catchTag("SyncUnavailableError", (cause) => Effect.fail(new BrainHost.BrainUnavailable({ cause }))),
        Effect.tapErrorTag("BrainUnavailable", () => brainHost.unavailable(placement.brainId)),
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

    yield* DurableRunner.register(StartRun, (payload) =>
      DurableRunner.supervise(
        `start:${payload.input.sessionId}`,
        startNow(payload.input, payload.placement).pipe(
          Effect.catchTag("BrainFailed", (error) =>
            Effect.logWarning(
              `The brain of ${payload.input.sessionId} failed; the start waits for a Retry: ${error.reason}`,
            ),
          ),
          Effect.catchTag("BrainRejectedError", (error) =>
            Effect.logError(`The brain rejected the start of ${payload.input.sessionId}: ${error.message}`),
          ),
          Effect.catchTag("BrainUnavailable", (error) =>
            Effect.logWarning(`The brain of ${payload.input.sessionId} is unavailable; the start retries`).pipe(
              Effect.andThen(Effect.fail(error)),
            ),
          ),
        ),
      ),
    )

    return Service.of({
      start: Effect.fn("Brains.start")(function* (input: Session.StartInput, placement: Placement) {
        if (input.initialMessage) yield* validatePrompt(input.initialMessage.prompt)
        const row = yield* brainRow(placement.brainId)
        yield* DurableRunner.ensure(StartRun, { input, placement, epoch: row.runEpoch }).pipe(
          Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
        )
      }),
      send: Effect.fn("Brains.send")(function* (input: Session.SendInput) {
        yield* validatePrompt(input.prompt)
        const session = yield* brainOf(input.sessionId)
        const target = yield* brainHost
          .target(session.brainId)
          .pipe(Effect.catchTag("BrainFailed", failedAsUnavailable))
        const api = yield* client.brain(target)
        return yield* call(
          api.brain["brain.send"]({ params: { id: input.sessionId }, payload: Struct.omit(input, ["sessionId"]) }),
        ).pipe(
          Effect.catchTag("SyncUnavailableError", (cause) => Effect.fail(new BrainHost.BrainUnavailable({ cause }))),
          Effect.tapErrorTag("BrainUnavailable", () => brainHost.unavailable(session.brainId)),
        )
      }),
      access: Effect.fn("Brains.access")(function* (
        sessionId: Session.ID,
        member: { readonly userId: Auth.UserID; readonly name?: string },
        options: { readonly unreachable?: boolean } = {},
      ) {
        const session = yield* brainOf(sessionId)
        // oxlint-disable-next-line ren/no-comments -- The app could not reach the brain's URL: the host checks the sandbox before Ren answers (E123).
        if (options.unreachable) yield* brainHost.unavailable(session.brainId)
        const state = yield* brainHost.access(session.brainId)
        if (state._tag === "Starting") return { status: "starting", phase: state.phase } satisfies Session.ClientAccess
        if (state._tag === "Failed") return { status: "failed", reason: state.reason } satisfies Session.ClientAccess
        if (!session.startedAt) return { status: "starting", phase: "starting the chat" } satisfies Session.ClientAccess
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
      prepare: Effect.fn("Brains.prepare")(function* (spaceId: Space.ID) {
        const brain = yield* spaceBrain(spaceId)
        if (Option.isNone(brain)) return
        const now = yield* Clock.currentTimeMillis
        if (now - (prepared.get(brain.value) ?? 0) < 5 * 60_000) return
        prepared.set(brain.value, now)
        yield* brainHost.ensure(brain.value)
      }),
      retry: Effect.fn("Brains.retry")(function* (sessionId: Session.ID) {
        const session = yield* brainOf(sessionId)
        yield* brainHost.retry(session.brainId)
      }),
      flush: Effect.fn("Brains.flush")(function* (sessionId: Session.ID) {
        const session = yield* brainOf(sessionId)
        const target = yield* brainHost
          .target(session.brainId)
          .pipe(Effect.catchTag("BrainFailed", failedAsUnavailable))
        const api = yield* client.brain(target)
        return yield* call(api.brain["brain.sync"]()).pipe(
          Effect.tapErrorTag("BrainUnavailable", () => brainHost.unavailable(session.brainId)),
        )
      }),
      authenticateHost: Effect.fn("Brains.authenticateHost")(function* (hostToken: Redacted.Redacted) {
        const claims = yield* client.verify(Redacted.value(hostToken))
        if (Option.isNone(claims) || claims.value.scope !== "host")
          return yield* new UnauthorizedError({ message: "The host token is not valid" })
        const brain = (yield* database.db
          .select({
            organizationId: Database.Schema.brain.organization_id,
            spaceId: Database.Schema.brain.space_id,
            generation: Database.Schema.brain.generation,
          })
          .from(Database.Schema.brain)
          .where(eq(Database.Schema.brain.id, claims.value.brain))
          .pipe(Effect.orDie)).at(0)
        if (!brain || brain.organizationId !== claims.value.org)
          return yield* new ForbiddenError({ message: "The host token names no brain of its organization" })
        if (brain.generation !== claims.value.gen)
          return yield* new GenerationRetiredError({
            message: `Generation ${claims.value.gen} of brain ${claims.value.brain} is retired`,
          })
        return {
          brainId: claims.value.brain,
          organizationId: claims.value.org,
          spaceId: brain.spaceId,
          generation: claims.value.gen,
        }
      }),
      pull: Effect.fn("Brains.pull")(function* (host: CurrentHost["Service"], request: PullRequest) {
        const apps = Predicate.isUndefined(request.apps)
          ? Option.none<PullApps>()
          : yield* appResolve.revision(host.spaceId).pipe(
              Effect.flatMap((revision) =>
                revision === request.apps
                  ? Effect.succeed<PullApps>({ fingerprint: revision })
                  : appResolve.forSpace(host.spaceId),
              ),
              Effect.map(Option.some),
              Effect.catch((error) =>
                Effect.logWarning("App catalog is unavailable for a pull; the brain keeps its catalog", error).pipe(
                  Effect.as(Option.none<PullApps>()),
                ),
              ),
            )
        const pulled = yield* settings
          .pull(host.brainId, request.layers)
          .pipe(
            Effect.catchTag("Settings.NotFound", (error) =>
              Effect.fail(new ForbiddenError({ message: error.message })),
            ),
          )
        const updated = yield* database.db
          .update(Database.Schema.brain)
          .set({ key_ids: [...request.keyIds] })
          .where(eq(Database.Schema.brain.id, host.brainId))
          .returning({ egress: Database.Schema.brain.egress })
          .pipe(Effect.orDie)
        const behindEgress = updated.at(0)?.egress ?? false
        const access = yield* models.grant(host.brainId, host.organizationId).pipe(
          Effect.map((granted) => Option.some(behindEgress ? Models.placeholders(granted) : granted)),
          Effect.catch((error) =>
            Effect.logWarning("Model access is unavailable for a pull; the brain keeps its models", error).pipe(
              Effect.as(Option.none<Models.Access>()),
            ),
          ),
        )
        yield* brainHost.observe(host.brainId, request.sessions)
        const roots = request.roots ?? []
        const kept =
          roots.length === 0
            ? []
            : yield* database.db
                .select({ id: Database.Schema.agent_session.id })
                .from(Database.Schema.agent_session)
                .where(inArray(Database.Schema.agent_session.id, [...roots]))
                .pipe(Effect.orDie)
        const hash = Option.isSome(access) ? yield* Models.hash(access.value) : (request.models ?? "")
        const variables = yield* credentialEnv.of({ kind: "brain", id: host.brainId, generation: host.generation })
        const envHash = yield* CredentialEnv.hash(variables)
        return {
          publicKeys: client.publicKeys,
          models: Option.isNone(access) || hash === request.models ? { hash } : { hash, access: access.value },
          ...Option.match(apps, { onNone: () => ({}), onSome: (catalog) => ({ apps: catalog }) }),
          layers: pulled.layers,
          chats: pulled.chats,
          deleted: roots.filter((id) => !kept.some((row) => row.id === id)),
          env: envHash === request.env ? { hash: envHash } : { hash: envHash, variables },
        } satisfies PullReply
      }),
      refreshModels: Effect.fn("Brains.refreshModels")(function* (host: CurrentHost["Service"]) {
        const access = yield* models.grant(host.brainId, host.organizationId).pipe(
          Effect.tapError((error) => Effect.logWarning("Model access refresh failed", error)),
          Effect.mapError(() => new ModelsUnavailableError({ message: "Model access is unavailable" })),
        )
        return { access, hostToken: Redacted.make(yield* client.hostToken(host)) } satisfies Brain.ModelGrant
      }),
      refreshHostToken: Effect.fn("Brains.refreshHostToken")(function* (host: CurrentHost["Service"]) {
        return { hostToken: Redacted.make(yield* client.hostToken(host)) }
      }),
      accessEnvironment: Effect.fn("Brains.accessEnvironment")(function* (
        host: CurrentHost["Service"],
        sessionId: Session.ID,
      ) {
        const subject = yield* inBrain(host, sessionId)
        return yield* environments.access(subject, yield* handOf(host.brainId, host.generation)).pipe(
          Effect.catchTags({
            "Environments.NotFound": (error) => Effect.fail(new EnvironmentNotFoundError({ message: error.message })),
            "Environments.Unavailable": (error) =>
              Effect.fail(new EnvironmentUnavailableError({ message: error.message })),
          }),
        )
      }),
      directoryOf: Effect.fn("Brains.directoryOf")(function* (host: CurrentHost["Service"], sessionId: Session.ID) {
        return yield* environments.findDirectory(
          yield* inBrain(host, sessionId),
          yield* handOf(host.brainId, host.generation),
        )
      }),
      releaseEnvironment: Effect.fn("Brains.releaseEnvironment")(function* (
        host: CurrentHost["Service"],
        sessionId: Session.ID,
      ) {
        yield* environments.release(yield* inBrain(host, sessionId))
      }),
    })
  }),
).pipe(Layer.provide([Access.layer, AppResolve.layer]))

export const hostAuthentication = Layer.effect(
  HostAuthentication,
  Effect.gen(function* () {
    const brain = yield* Service
    return HostAuthentication.of({
      bearer: Effect.fn("Brains.hostAuthentication")(function* (httpEffect, options) {
        const host = yield* brain.authenticateHost(options.credential)
        return yield* httpEffect.pipe(Effect.provideService(CurrentHost, host))
      }),
    })
  }),
)
