export * as Hands from "./hands.js"

import { ExecutorVariables } from "@ren/hand-api/executor-variables"
import { HandToken } from "@ren/hand-api/hand-token"
import { Signature } from "@ren/hand-api/signature"
import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Hand } from "@ren/schema/hand"
import type { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { and, asc, count, eq, exists, isNull, type SQLWrapper, sql } from "drizzle-orm"
import { Array, Clock, Config, Context, DateTime, Duration, Effect, Layer, Option, Redacted, Schema } from "effect"
import { HandProvider } from "./hand-provider.js"

interface Subject {
  readonly sessionId: Session.ID
  readonly organizationId: Auth.OrganizationID
}

export interface Placement {
  readonly organizationId: Auth.OrganizationID
  readonly spaceId: Space.ID
}

interface Bound {
  readonly directory: Hand.Directory
  readonly isNew: boolean
}

export interface Interface {
  readonly bind: (
    placement: Subject & Placement,
    environmentId: Environment.ID,
  ) => Effect.Effect<Bound, NotFound | Changed>
  readonly findDirectory: (subject: Subject) => Effect.Effect<Option.Option<Hand.Directory>>
  readonly unbind: (subject: Subject) => Effect.Effect<void>
  readonly access: (subject: Subject) => Effect.Effect<Hand.Access, NotFound | Unavailable>
  readonly release: (subject: Subject) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Hands") {}

export class NotFound extends Schema.TaggedError<NotFound>()("Hands.NotFound", { message: Schema.String }) {}

export class Changed extends Schema.TaggedError<Changed>()("Hands.Changed", { message: Schema.String }) {}

export class Unavailable extends Schema.TaggedError<Unavailable>()("Hands.Unavailable", {
  message: Schema.String,
}) {}

const environments = Database.Schema.environment
const hands = Database.Schema.hand
const sessions = Database.Schema.session_environment
const spaceEnvironments = Database.Schema.space_environment
const spaces = Database.Schema.space

const isAvailable = (organizationId: Auth.OrganizationID, spaceId: SQLWrapper) =>
  and(
    eq(environments.organization_id, organizationId),
    isNull(environments.archived_at),
    exists(
      sql`(select 1 from ${spaceEnvironments} inner join ${spaces} on ${spaces.id} = ${spaceEnvironments.space_id} where ${and(
        eq(spaceEnvironments.space_id, spaceId),
        eq(spaceEnvironments.environment_id, environments.id),
        isNull(spaceEnvironments.archived_at),
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
      keys: Config.option(Config.schema(Schema.RedactedFromValue(Signature.PrivateKeys), "HAND_KEYS")),
      lifetime: Config.Duration("HAND_TOKEN_LIFETIME").pipe(Config.withDefault(Duration.minutes(15))),
      directory: Config.String("HAND_DIRECTORY").pipe(Config.withDefault("/workspace")),
    })
    const database = yield* Database.Service
    const registry = yield* HandProvider.Registry
    const directoryOf = (sessionId: Session.ID) => `${config.directory}/${sessionId}`
    const signing = yield* Option.match(config.keys, {
      onNone: () => Effect.succeedNone,
      onSome: (keys) =>
        Effect.gen(function* () {
          const privateKeys = Redacted.value(keys)
          const key = Array.headNonEmpty(privateKeys)
          const first = yield* Signature.publicKeyOf(key)
          const rest = yield* Effect.forEach(Array.tailNonEmpty(privateKeys), Signature.publicKeyOf)
          return Option.some({ key, publicKeys: [first, ...rest] as const })
        }),
    })

    const checkAvailable = Effect.fnUntraced(function* (placement: Subject & Placement, environmentId: Environment.ID) {
      const rows = yield* database.db
        .select({ provider: environments.provider })
        .from(environments)
        .where(
          and(eq(environments.id, environmentId), isAvailable(placement.organizationId, sql`${placement.spaceId}`)),
        )
        .pipe(Effect.orDie)
      const provider = Option.flatMap(Option.fromNullishOr(rows.at(0)), (row) => registry.get(row.provider))
      if (Option.isNone(provider))
        return yield* new NotFound({ message: `Environment ${environmentId} is not available to this session’s space` })
    })

    const assign = Effect.fn("Hands.assign")(function* (subject: Subject) {
      return yield* database.transaction((transaction) =>
        Effect.gen(function* () {
          const sessionRows = yield* transaction
            .select({
              spaceId: sessions.space_id,
              environmentId: sessions.environment_id,
              handId: sessions.hand_id,
              idleAt: sessions.idle_at,
              generation: sessions.generation,
            })
            .from(sessions)
            .innerJoin(spaces, eq(spaces.id, sessions.space_id))
            .where(and(eq(sessions.session_id, subject.sessionId), eq(spaces.organization_id, subject.organizationId)))
            .for("update", { of: sessions })
          const session = sessionRows.at(0)
          if (!session) return yield* new NotFound({ message: `Session ${subject.sessionId} has no environment` })
          const environmentRows = yield* transaction
            .select()
            .from(environments)
            .where(
              and(
                eq(environments.id, session.environmentId),
                isAvailable(subject.organizationId, sql`${session.spaceId}`),
              ),
            )
            .for("update", { of: environments })
          const environment = environmentRows.at(0)
          if (!environment)
            return yield* new NotFound({
              message: `The environment of session ${subject.sessionId} is archived or no longer linked to its space`,
            })
          const existing = session.handId
            ? Option.some(session.handId)
            : Option.fromNullishOr(
                (yield* transaction
                  .select({ id: hands.id })
                  .from(hands)
                  .leftJoin(sessions, and(eq(sessions.hand_id, hands.id), isNull(sessions.idle_at)))
                  .where(eq(hands.environment_id, environment.id))
                  .groupBy(hands.id, hands.created_at)
                  .having(sql`${count(sessions.session_id)} < ${environment.sessions_per_hand}`)
                  .orderBy(asc(hands.created_at))
                  .limit(1)).at(0)?.id,
              )
          const handId = yield* Option.match(existing, {
            onSome: Effect.succeed,
            onNone: () => {
              const id = Hand.ID.create()
              return transaction.insert(hands).values({ id, environment_id: environment.id }).pipe(Effect.as(id))
            },
          })
          if (!session.handId || session.idleAt)
            yield* transaction
              .update(sessions)
              .set({ hand_id: handId, idle_at: null })
              .where(eq(sessions.session_id, subject.sessionId))
          const hand = yield* transaction.select({ binding: hands.binding }).from(hands).where(eq(hands.id, handId))
          return {
            environment,
            handId,
            providerBinding: hand.at(0)?.binding ?? null,
            generation: session.generation,
          }
        }),
      )
    })

    const replace = (handId: Hand.ID) =>
      database.transaction((transaction) =>
        Effect.gen(function* () {
          yield* transaction
            .update(sessions)
            .set({ hand_id: null, generation: sql`${sessions.generation} + 1` })
            .where(eq(sessions.hand_id, handId))
          yield* transaction.delete(hands).where(eq(hands.id, handId))
        }),
      )

    const grantAccess = Effect.fnUntraced(function* (
      subject: Subject,
      options: { readonly isRetry: boolean },
    ): Effect.fn.Return<Hand.Access, NotFound | Unavailable> {
      const keys = yield* Option.match(signing, {
        onNone: () => Effect.die(new Error("HAND_KEYS has no signing key")),
        onSome: Effect.succeed,
      })
      const environmentRows = yield* database.db
        .select({ provider: environments.provider })
        .from(sessions)
        .innerJoin(environments, eq(environments.id, sessions.environment_id))
        .where(eq(sessions.session_id, subject.sessionId))
        .pipe(Effect.orDie)
      const provider = Option.flatMap(Option.fromNullishOr(environmentRows.at(0)), (row) => registry.get(row.provider))
      if (Option.isNone(provider))
        return yield* new NotFound({ message: `Session ${subject.sessionId} has no environment this Ren can run` })
      const assigned = yield* assign(subject)
      const unavailableBecause = (error: HandProvider.Failed) =>
        new Unavailable({ message: `The hand of session ${subject.sessionId} is unavailable: ${error.message}` })
      const providerBinding =
        assigned.providerBinding ??
        (yield* provider.value
          .provision({
            handId: assigned.handId,
            environmentId: assigned.environment.id,
            config: assigned.environment.config,
            variables: ExecutorVariables.make(assigned.handId, keys.publicKeys),
          })
          .pipe(
            Effect.mapError(unavailableBecause),
            Effect.tap((made) =>
              database.db
                .update(hands)
                .set({ binding: made })
                .where(and(eq(hands.id, assigned.handId), isNull(hands.binding)))
                .pipe(Effect.orDie),
            ),
          ))
      const endpoint = yield* provider.value.connect(providerBinding).pipe(
        Effect.map(Option.some),
        Effect.catchTag("HandProvider.Gone", (gone) =>
          options.isRetry
            ? Effect.fail(new Unavailable({ message: gone.message }))
            : replace(assigned.handId).pipe(Effect.as(Option.none())),
        ),
        Effect.catchTag("HandProvider.Failed", (error) => Effect.fail(unavailableBecause(error))),
      )
      if (Option.isNone(endpoint)) return yield* grantAccess(subject, { isRetry: true })
      const exp = Math.floor(((yield* Clock.currentTimeMillis) + Duration.toMillis(config.lifetime)) / 1000)
      return {
        directory: directoryOf(subject.sessionId),
        url: endpoint.value.url,
        token: Redacted.make(
          yield* HandToken.sign(keys.key, {
            hand: assigned.handId,
            brain: Brain.ofSession(subject.sessionId),
            exp,
          }),
        ),
        expiresAt: DateTime.makeUnsafe(exp * 1000),
        generation: assigned.generation,
      } satisfies Hand.Access
    })

    return Service.of({
      bind: Effect.fn("Hands.bind")(function* (placement: Subject & Placement, environmentId: Environment.ID) {
        yield* checkAvailable(placement, environmentId)
        const inserted = yield* database.db
          .insert(sessions)
          .values({
            session_id: placement.sessionId,
            space_id: placement.spaceId,
            environment_id: environmentId,
          })
          .onConflictDoNothing()
          .returning({ session_id: sessions.session_id })
          .pipe(Effect.orDie)
        if (inserted.length > 0) return { directory: directoryOf(placement.sessionId), isNew: true }
        const existing = yield* database.db
          .select({ environment_id: sessions.environment_id, space_id: sessions.space_id })
          .from(sessions)
          .where(eq(sessions.session_id, placement.sessionId))
          .pipe(Effect.orDie)
        const found = existing.at(0)
        if (found?.environment_id === environmentId && found.space_id === placement.spaceId)
          return { directory: directoryOf(placement.sessionId), isNew: false }
        return yield* new Changed({
          message: `Session ${placement.sessionId} cannot change its environment or space: not supported yet`,
        })
      }),
      findDirectory: Effect.fn("Hands.findDirectory")(function* (subject: Subject) {
        const rows = yield* database.db
          .select({ environmentId: sessions.environment_id, provider: environments.provider })
          .from(sessions)
          .innerJoin(environments, eq(environments.id, sessions.environment_id))
          .where(
            and(eq(sessions.session_id, subject.sessionId), isAvailable(subject.organizationId, sessions.space_id)),
          )
          .pipe(Effect.orDie)
        return Option.flatMap(Option.fromNullishOr(rows.at(0)), (row) =>
          Option.map(registry.get(row.provider), () => directoryOf(subject.sessionId)),
        )
      }),
      unbind: Effect.fn("Hands.unbind")(function* (subject: Subject) {
        yield* database.db.delete(sessions).where(isSessionOf(subject)).pipe(Effect.orDie)
      }),
      access: Effect.fn("Hands.access")(function* (subject: Subject) {
        return yield* grantAccess(subject, { isRetry: false })
      }),
      release: Effect.fn("Hands.release")(function* (subject: Subject) {
        yield* database.db
          .update(sessions)
          .set({ idle_at: sql`now()` })
          .where(and(isSessionOf(subject), isNull(sessions.idle_at)))
          .pipe(Effect.orDie)
      }),
    })
  }),
)
