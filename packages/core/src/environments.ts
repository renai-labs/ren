export * as Environments from "./environments.js"

import { Observability } from "@ren/schema/observability"
import { ExecutorVariables } from "@ren/environment-api/executor-variables"
import type { EnvironmentToken } from "@ren/environment-api/environment-token"
import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import type { Brain } from "@ren/schema/brain"
import { EnvironmentTemplate } from "@ren/schema/environment-template"
import { Environment } from "@ren/schema/environment"
import type { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { and, asc, count, eq, exists, inArray, isNull, type SQLWrapper, sql } from "drizzle-orm"
import { Clock, Config, Context, DateTime, Duration, Effect, Layer, Option, Redacted, Schema } from "effect"
import { Deployment } from "./deployment.js"
import { EnvironmentProvider } from "./environment-provider.js"
import { Signer } from "./signer.js"

interface Subject {
  readonly sessionId: Session.ID
  readonly organizationId: Auth.OrganizationID
}

export interface Placement {
  readonly organizationId: Auth.OrganizationID
  readonly spaceId: Space.ID
}

export interface Hand {
  readonly brainId: Brain.ID
  readonly generation: number
  readonly url: string
  readonly workspace: Environment.Directory
  readonly egress: boolean
  readonly canMount: boolean
}

export interface Capability {
  readonly canMount: boolean
  readonly egress: boolean
}

interface Bound {
  readonly directory: Environment.Directory
  readonly isNew: boolean
}

export interface Interface {
  readonly bind: (
    placement: Subject & Placement,
    environmentTemplateId: EnvironmentTemplate.ID,
  ) => Effect.Effect<Bound, NotFound | Changed>
  readonly findDirectory: (
    subject: Subject,
    hand: Option.Option<Hand>,
  ) => Effect.Effect<Option.Option<Environment.Directory>>
  readonly capabilities: (
    organizationId: Auth.OrganizationID,
    sessionIds: ReadonlyArray<Session.ID>,
    hand: Option.Option<Hand>,
  ) => Effect.Effect<ReadonlyMap<Session.ID, Capability>>
  readonly unbind: (subject: Subject) => Effect.Effect<void>
  readonly access: (
    subject: Subject,
    hand: Option.Option<Hand>,
  ) => Effect.Effect<Environment.Access, NotFound | Unavailable>
  readonly release: (subject: Subject) => Effect.Effect<void>
  readonly executorVariables: (environmentId: Environment.ID) => Effect.Effect<Readonly<Record<string, string>>>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Environments") {}

export class NotFound extends Schema.TaggedError<NotFound>()("Environments.NotFound", { message: Schema.String }) {}

export class Changed extends Schema.TaggedError<Changed>()("Environments.Changed", { message: Schema.String }) {}

export class Unavailable extends Schema.TaggedError<Unavailable>()("Environments.Unavailable", {
  message: Schema.String,
}) {}

const templates = Database.Schema.environment_template
const environments = Database.Schema.environment
const sessions = Database.Schema.session_environment
const spaceEnvironmentTemplates = Database.Schema.space_environment_template
const spaces = Database.Schema.space

const isAvailable = (organizationId: Auth.OrganizationID, spaceId: SQLWrapper) =>
  and(
    eq(templates.organization_id, organizationId),
    isNull(templates.archived_at),
    exists(
      sql`(select 1 from ${spaceEnvironmentTemplates} inner join ${spaces} on ${spaces.id} = ${spaceEnvironmentTemplates.space_id} where ${and(
        eq(spaceEnvironmentTemplates.space_id, spaceId),
        eq(spaceEnvironmentTemplates.environment_template_id, templates.id),
        isNull(spaceEnvironmentTemplates.archived_at),
        isNull(spaces.archived_at),
      )})`,
    ),
  )

const isSessionOf = (subject: Subject) =>
  and(
    eq(sessions.session_id, subject.sessionId),
    exists(
      sql`(select 1 from ${spaces} where ${and(eq(spaces.id, sessions.space_id), eq(spaces.organization_id, subject.organizationId))})`,
    ),
  )

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.all({
      lifetime: Config.Duration("ENVIRONMENT_TOKEN_LIFETIME").pipe(Config.withDefault(Duration.minutes(15))),
      directory: Config.String("ENVIRONMENT_DIRECTORY").pipe(Config.withDefault("/workspace")),
    })
    const database = yield* Database.Service
    const registry = yield* EnvironmentProvider.Registry
    const sandboxVariables = yield* Deployment.sandboxVariables
    const directoryOf = (sessionId: Session.ID) => `${config.directory}/${sessionId}`
    const signer = yield* Signer.Service
    const signingKeys = signer.publicKeys("environment").pipe(
      Effect.map((publicKeys) => ({ publicKeys })),
      Effect.orDie,
    )
    const signToken = (claims: Omit<EnvironmentToken.Claims, "typ" | "kid">) =>
      signer.sign("environment", { ...claims, typ: "environment" }).pipe(Effect.orDie)

    const expiry = Effect.map(Clock.currentTimeMillis, (now) =>
      Math.floor((now + Duration.toMillis(config.lifetime)) / 1000),
    )

    const isBound = (subject: Subject) =>
      database.db
        .select({ sessionId: sessions.session_id })
        .from(sessions)
        .where(isSessionOf(subject))
        .pipe(
          Effect.orDie,
          Effect.map((rows) => rows.length > 0),
        )

    const handDirectory = (hand: Hand, sessionId: Session.ID) => `${hand.workspace}/${sessionId}`

    const checkAvailable = Effect.fnUntraced(function* (
      placement: Subject & Placement,
      environmentTemplateId: EnvironmentTemplate.ID,
    ) {
      const rows = yield* database.db
        .select({ provider: templates.provider })
        .from(templates)
        .where(
          and(
            eq(templates.id, environmentTemplateId),
            isAvailable(placement.organizationId, sql`${placement.spaceId}`),
          ),
        )
        .pipe(Effect.orDie)
      const provider = Option.flatMap(Option.fromNullishOr(rows.at(0)), (row) => registry.get(row.provider))
      if (Option.isNone(provider))
        return yield* new NotFound({
          message: `Environment template ${environmentTemplateId} is not available to this session’s space`,
        })
    })

    const assign = Effect.fn("Environments.assign")(function* (subject: Subject) {
      yield* Effect.annotateCurrentSpan({
        "ren.session.id": subject.sessionId,
        "ren.organization.id": subject.organizationId,
      })
      return yield* database.transaction((transaction) =>
        Effect.gen(function* () {
          const sessionRows = yield* transaction
            .select({
              spaceId: sessions.space_id,
              environmentTemplateId: sessions.environment_template_id,
              environmentId: sessions.environment_id,
              idleAt: sessions.idle_at,
              generation: sessions.generation,
              brainId: Database.Schema.agent_session.brain_id,
            })
            .from(sessions)
            .innerJoin(spaces, eq(spaces.id, sessions.space_id))
            .innerJoin(Database.Schema.agent_session, eq(Database.Schema.agent_session.id, sessions.session_id))
            .where(and(eq(sessions.session_id, subject.sessionId), eq(spaces.organization_id, subject.organizationId)))
            .for("update", { of: sessions })
          const session = sessionRows.at(0)
          if (!session) return yield* new NotFound({ message: `Session ${subject.sessionId} has no environment` })
          const templateRows = yield* transaction
            .select()
            .from(templates)
            .where(
              and(
                eq(templates.id, session.environmentTemplateId),
                isAvailable(subject.organizationId, sql`${session.spaceId}`),
              ),
            )
            .for("update", { of: templates })
          const template = templateRows.at(0)
          if (!template)
            return yield* new NotFound({
              message: `The environment template of session ${subject.sessionId} is archived or no longer linked to its space`,
            })
          const existing = session.environmentId
            ? Option.some(session.environmentId)
            : Option.fromNullishOr(
                (yield* transaction
                  .select({ id: environments.id })
                  .from(environments)
                  .leftJoin(sessions, and(eq(sessions.environment_id, environments.id), isNull(sessions.idle_at)))
                  .where(
                    and(
                      eq(environments.environment_template_id, template.id),
                      eq(environments.space_id, session.spaceId),
                    ),
                  )
                  .groupBy(environments.id, environments.created_at)
                  .having(sql`${count(sessions.session_id)} < ${template.sessions_per_environment}`)
                  .orderBy(asc(environments.created_at))
                  .limit(1)).at(0)?.id,
              )
          const environmentId = yield* Option.match(existing, {
            onSome: Effect.succeed,
            onNone: () => {
              const id = Environment.ID.create()
              return transaction
                .insert(environments)
                .values({ id, environment_template_id: template.id, space_id: session.spaceId })
                .pipe(Effect.as(id))
            },
          })
          if (!session.environmentId || session.idleAt)
            yield* transaction
              .update(sessions)
              .set({ environment_id: environmentId, idle_at: null })
              .where(eq(sessions.session_id, subject.sessionId))
          const environment = yield* transaction
            .select({ binding: environments.binding })
            .from(environments)
            .where(eq(environments.id, environmentId))
          return {
            template,
            environmentId,
            providerBinding: environment.at(0)?.binding ?? null,
            generation: session.generation,
            brainId: session.brainId,
          }
        }),
      )
    }, Observability.Trace.environmentAssign)

    const replace = (environmentId: Environment.ID) =>
      database.transaction((transaction) =>
        Effect.gen(function* () {
          yield* transaction
            .update(sessions)
            .set({ environment_id: null, generation: sql`${sessions.generation} + 1` })
            .where(eq(sessions.environment_id, environmentId))
          yield* transaction.delete(environments).where(eq(environments.id, environmentId))
        }),
      )

    const grantAccess = Effect.fnUntraced(function* (
      subject: Subject,
      hand: Option.Option<Hand>,
      options: { readonly isRetry: boolean },
    ): Effect.fn.Return<Environment.Access, NotFound | Unavailable> {
      if (Option.isSome(hand) && !(yield* isBound(subject))) {
        const exp = yield* expiry
        return {
          directory: handDirectory(hand.value, subject.sessionId),
          url: new URL(hand.value.url),
          token: Redacted.make(
            yield* signToken({
              environment: Environment.ofBrain(hand.value.brainId),
              brain: hand.value.brainId,
              exp,
            }),
          ),
          expiresAt: DateTime.makeUnsafe(exp * 1000),
          generation: hand.value.generation,
          egress: hand.value.egress,
          sharedDirectory: `${hand.value.workspace}/.ren`,
        } satisfies Environment.Access
      }
      const templateRows = yield* database.db
        .select({ provider: templates.provider })
        .from(sessions)
        .innerJoin(templates, eq(templates.id, sessions.environment_template_id))
        .where(eq(sessions.session_id, subject.sessionId))
        .pipe(Effect.orDie)
      const provider = Option.flatMap(Option.fromNullishOr(templateRows.at(0)), (row) => registry.get(row.provider))
      if (Option.isNone(provider))
        return yield* new NotFound({
          message: `Session ${subject.sessionId} has no environment template this Ren can run`,
        })
      const keys = yield* signingKeys
      const assigned = yield* assign(subject)
      const unavailableBecause = (error: EnvironmentProvider.Failed) =>
        new Unavailable({ message: `The environment of session ${subject.sessionId} is unavailable: ${error.message}` })
      const providerBinding =
        assigned.providerBinding ??
        (yield* provider.value
          .provision({
            environmentId: assigned.environmentId,
            environmentTemplateId: assigned.template.id,
            config: assigned.template.config,
            variables: {
              ...ExecutorVariables.make(assigned.environmentId, keys.publicKeys),
              ...sandboxVariables({ "ren.organization.id": subject.organizationId }),
            },
          })
          .pipe(
            Effect.mapError(unavailableBecause),
            Effect.tap((made) =>
              database.db
                .update(environments)
                .set({ binding: made })
                .where(and(eq(environments.id, assigned.environmentId), isNull(environments.binding)))
                .pipe(Effect.orDie),
            ),
          ))
      const endpoint = yield* provider.value.connect(providerBinding).pipe(
        Effect.map(Option.some),
        Effect.catchTag("EnvironmentProvider.Gone", (gone) =>
          options.isRetry
            ? Effect.fail(new Unavailable({ message: gone.message }))
            : replace(assigned.environmentId).pipe(Effect.as(Option.none())),
        ),
        Effect.catchTag("EnvironmentProvider.Failed", (error) => Effect.fail(unavailableBecause(error))),
      )
      if (Option.isNone(endpoint)) return yield* grantAccess(subject, hand, { isRetry: true })
      const exp = yield* expiry
      return {
        directory: directoryOf(subject.sessionId),
        url: endpoint.value.url,
        token: Redacted.make(
          yield* signToken({
            environment: assigned.environmentId,
            brain: assigned.brainId,
            exp,
          }),
        ),
        expiresAt: DateTime.makeUnsafe(exp * 1000),
        generation: assigned.generation,
        egress: provider.value.egress,
        // oxlint-disable-next-line ren/no-comments -- R49, R59: the folder beside the session folders, which every session on the environment shares.
        sharedDirectory: `${config.directory}/.ren`,
      } satisfies Environment.Access
    })

    return Service.of({
      bind: Effect.fn("Environments.bind")(function* (
        placement: Subject & Placement,
        environmentTemplateId: EnvironmentTemplate.ID,
      ) {
        yield* checkAvailable(placement, environmentTemplateId)
        const inserted = yield* database.db
          .insert(sessions)
          .values({
            session_id: placement.sessionId,
            space_id: placement.spaceId,
            environment_template_id: environmentTemplateId,
          })
          .onConflictDoNothing()
          .returning({ session_id: sessions.session_id })
          .pipe(Effect.orDie)
        if (inserted.length > 0) return { directory: directoryOf(placement.sessionId), isNew: true }
        const existing = yield* database.db
          .select({ environment_template_id: sessions.environment_template_id, space_id: sessions.space_id })
          .from(sessions)
          .where(eq(sessions.session_id, placement.sessionId))
          .pipe(Effect.orDie)
        const found = existing.at(0)
        if (found?.environment_template_id === environmentTemplateId && found.space_id === placement.spaceId)
          return { directory: directoryOf(placement.sessionId), isNew: false }
        return yield* new Changed({
          message: `Session ${placement.sessionId} cannot change its environment template or space: not supported yet`,
        })
      }),
      findDirectory: Effect.fn("Environments.findDirectory")(function* (subject: Subject, hand: Option.Option<Hand>) {
        if (Option.isSome(hand) && !(yield* isBound(subject)))
          return Option.some(handDirectory(hand.value, subject.sessionId))
        const rows = yield* database.db
          .select({ environmentTemplateId: sessions.environment_template_id, provider: templates.provider })
          .from(sessions)
          .innerJoin(templates, eq(templates.id, sessions.environment_template_id))
          .where(
            and(eq(sessions.session_id, subject.sessionId), isAvailable(subject.organizationId, sessions.space_id)),
          )
          .pipe(Effect.orDie)
        return Option.flatMap(Option.fromNullishOr(rows.at(0)), (row) =>
          Option.map(registry.get(row.provider), () => directoryOf(subject.sessionId)),
        )
      }),
      capabilities: Effect.fn("Environments.capabilities")(function* (
        organizationId: Auth.OrganizationID,
        sessionIds: ReadonlyArray<Session.ID>,
        hand: Option.Option<Hand>,
      ) {
        const bound =
          sessionIds.length === 0
            ? []
            : yield* database.db
                .select({ sessionId: sessions.session_id, provider: templates.provider })
                .from(sessions)
                .leftJoin(
                  templates,
                  and(
                    eq(templates.id, sessions.environment_template_id),
                    isAvailable(organizationId, sessions.space_id),
                  ),
                )
                .where(inArray(sessions.session_id, [...sessionIds]))
                .pipe(Effect.orDie)
        const providers = new Map(bound.map((row) => [row.sessionId, row.provider]))
        return new Map(
          sessionIds.flatMap((sessionId) => {
            const capability = providers.has(sessionId)
              ? Option.map(
                  Option.flatMap(Option.fromNullishOr(providers.get(sessionId)), registry.get),
                  (provider) => ({
                    canMount: provider.canMount,
                    egress: provider.egress,
                  }),
                )
              : Option.map(hand, (found) => ({ canMount: found.canMount, egress: found.egress }))
            return Option.isSome(capability) ? [[sessionId, capability.value] as const] : []
          }),
        )
      }),
      unbind: Effect.fn("Environments.unbind")(function* (subject: Subject) {
        yield* database.db.delete(sessions).where(isSessionOf(subject)).pipe(Effect.orDie)
      }),
      access: Effect.fn("Environments.access")(function* (subject: Subject, hand: Option.Option<Hand>) {
        return yield* grantAccess(subject, hand, { isRetry: false })
      }),
      release: Effect.fn("Environments.release")(function* (subject: Subject) {
        yield* database.db
          .update(sessions)
          .set({ idle_at: sql`now()` })
          .where(and(isSessionOf(subject), isNull(sessions.idle_at)))
          .pipe(Effect.orDie)
      }),
      executorVariables: Effect.fn("Environments.executorVariables")(function* (environmentId: Environment.ID) {
        const keys = yield* signingKeys
        return ExecutorVariables.make(environmentId, keys.publicKeys)
      }),
    })
  }),
)
