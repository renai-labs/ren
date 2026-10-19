export * as Hands from "./hands.js"

import { EnvironmentToken } from "@ren/hand-api/environment-token"
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
import { HandProviders } from "./hand-providers.js"

interface Subject {
  readonly brainId: Session.ID
  readonly organizationId: Auth.OrganizationID
}

interface Placement extends Subject {
  readonly spaceId: Space.ID
}

const SigningKeys = Schema.fromJsonString(Schema.NonEmptyArray(Signature.PrivateKey)).annotate({
  identifier: "Hands.SigningKeys",
})

export class NotFound extends Schema.TaggedError<NotFound>()("Hands.NotFound", { message: Schema.String }) {}

export class Changed extends Schema.TaggedError<Changed>()("Hands.Changed", { message: Schema.String }) {}

export class Unavailable extends Schema.TaggedError<Unavailable>()("Hands.Unavailable", {
  message: Schema.String,
}) {}

interface Binding {
  readonly directory: string
  readonly isNew: boolean
}

export interface Interface {
  readonly bind: (placement: Placement, environmentId: Environment.ID) => Effect.Effect<Binding, NotFound | Changed>
  readonly find: (subject: Subject) => Effect.Effect<Option.Option<string>>
  readonly unbind: (sessionId: Session.ID) => Effect.Effect<void>
  readonly access: (subject: Subject) => Effect.Effect<Hand.Access, NotFound | Unavailable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Hands") {}

const environments = Database.Schema.environment
const hands = Database.Schema.hand
const sessions = Database.Schema.session_environment
const spaceEnvironments = Database.Schema.space_environment
const spaces = Database.Schema.space

const isEnvironmentOfSpace = (spaceId: SQLWrapper, environmentId: SQLWrapper) =>
  exists(
    sql`(select 1 from ${spaceEnvironments} inner join ${spaces} on ${spaces.id} = ${spaceEnvironments.space_id} where ${and(
      eq(spaceEnvironments.space_id, spaceId),
      eq(spaceEnvironments.environment_id, environmentId),
      isNull(spaceEnvironments.archived_at),
      isNull(spaces.archived_at),
    )})`,
  )

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.all({
      keys: Config.option(Config.schema(Schema.RedactedFromValue(SigningKeys), "ENVIRONMENT_KEYS")),
      lifetime: Config.Duration("ENVIRONMENT_TOKEN_LIFETIME").pipe(Config.withDefault(Duration.minutes(15))),
      directory: Config.String("HAND_DIRECTORY").pipe(Config.withDefault("/workspace")),
    })
    const database = yield* Database.Service
    const registry = yield* HandProviders.Registry
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

    const usable = Effect.fnUntraced(function* (placement: Placement, environmentId: Environment.ID) {
      const rows = yield* database.db
        .select({ provider: environments.provider })
        .from(environments)
        .where(
          and(
            eq(environments.id, environmentId),
            eq(environments.organization_id, placement.organizationId),
            isNull(environments.archived_at),
            isEnvironmentOfSpace(sql`${placement.spaceId}`, environments.id),
          ),
        )
        .pipe(Effect.orDie)
      const provider = Option.flatMap(Option.fromNullishOr(rows.at(0)), (row) => registry.get(row.provider))
      if (Option.isNone(provider))
        return yield* new NotFound({ message: `Environment ${environmentId} is not available to this session’s space` })
    })

    const assign = (subject: Subject) =>
      database.transaction((transaction) =>
        Effect.gen(function* () {
          const bound = yield* transaction
            .select({
              spaceId: sessions.space_id,
              environmentId: sessions.environment_id,
              handId: sessions.hand_id,
              generation: sessions.generation,
            })
            .from(sessions)
            .innerJoin(spaces, eq(spaces.id, sessions.space_id))
            .where(and(eq(sessions.session_id, subject.brainId), eq(spaces.organization_id, subject.organizationId)))
            .for("update", { of: sessions })
          const session = bound.at(0)
          if (!session) return yield* new NotFound({ message: `Session ${subject.brainId} has no environment` })
          const found = yield* transaction
            .select()
            .from(environments)
            .where(
              and(
                eq(environments.id, session.environmentId),
                isNull(environments.archived_at),
                isEnvironmentOfSpace(sql`${session.spaceId}`, environments.id),
              ),
            )
            .for("update", { of: environments })
          const environment = found.at(0)
          if (!environment)
            return yield* new NotFound({
              message: `The environment of session ${subject.brainId} is archived or no longer linked to its space`,
            })
          const assigned = session.handId
            ? Option.some(session.handId)
            : Option.fromNullishOr(
                (yield* transaction
                  .select({ id: hands.id })
                  .from(hands)
                  .leftJoin(sessions, eq(sessions.hand_id, hands.id))
                  .where(eq(hands.environment_id, environment.id))
                  .groupBy(hands.id, hands.created_at)
                  .having(sql`${count(sessions.session_id)} < ${environment.sessions_per_hand}`)
                  .orderBy(asc(hands.created_at))
                  .limit(1)).at(0)?.id,
              )
          const handId = yield* Option.match(assigned, {
            onSome: Effect.succeed,
            onNone: () => {
              const id = Hand.ID.create()
              return transaction.insert(hands).values({ id, environment_id: environment.id }).pipe(Effect.as(id))
            },
          })
          if (!session.handId)
            yield* transaction.update(sessions).set({ hand_id: handId }).where(eq(sessions.session_id, subject.brainId))
          const hand = yield* transaction.select({ binding: hands.binding }).from(hands).where(eq(hands.id, handId))
          return { environment, handId, binding: hand.at(0)?.binding ?? null, generation: session.generation }
        }),
      )

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

    const connect = Effect.fnUntraced(function* (
      subject: Subject,
      isRetry: boolean,
    ): Effect.fn.Return<Hand.Access, NotFound | Unavailable> {
      const assigned = yield* assign(subject)
      const keys = yield* Option.match(signing, {
        onNone: () => Effect.die(new Error("ENVIRONMENT_KEYS has no signing key")),
        onSome: Effect.succeed,
      })
      const provider = registry.get(assigned.environment.provider)
      if (Option.isNone(provider))
        return yield* new Unavailable({ message: `Ren has no hand provider ${assigned.environment.provider}` })
      const unavailable = (error: HandProviders.Failed) =>
        new Unavailable({ message: `The hand of session ${subject.brainId} is unavailable: ${error.message}` })
      const binding =
        assigned.binding ??
        (yield* provider.value
          .provision({
            handId: assigned.handId,
            environmentId: assigned.environment.id,
            config: assigned.environment.config,
            publicKeys: keys.publicKeys,
          })
          .pipe(
            Effect.mapError(unavailable),
            Effect.tap((made) =>
              database.db
                .update(hands)
                .set({ binding: made })
                .where(and(eq(hands.id, assigned.handId), isNull(hands.binding)))
                .pipe(Effect.orDie),
            ),
          ))
      const endpoint = yield* provider.value.connect(binding).pipe(
        Effect.map(Option.some),
        Effect.catchTag("HandProviders.Gone", (gone) =>
          isRetry
            ? Effect.fail(new Unavailable({ message: gone.message }))
            : replace(assigned.handId).pipe(Effect.as(Option.none())),
        ),
        Effect.mapError((error) => (error instanceof HandProviders.Failed ? unavailable(error) : error)),
      )
      if (Option.isNone(endpoint)) return yield* connect(subject, true)
      const exp = Math.floor(((yield* Clock.currentTimeMillis) + Duration.toMillis(config.lifetime)) / 1000)
      return {
        directory: directoryOf(subject.brainId),
        url: endpoint.value.url,
        token: Redacted.make(
          yield* EnvironmentToken.sign(keys.key, {
            env: assigned.environment.id,
            brain: Brain.ofSession(subject.brainId),
            exp,
          }),
        ),
        expiresAt: DateTime.makeUnsafe(exp * 1000),
        generation: assigned.generation,
      } satisfies Hand.Access
    })

    return Service.of({
      bind: Effect.fn("Hands.bind")(function* (placement: Placement, environmentId: Environment.ID) {
        yield* usable(placement, environmentId)
        const inserted = yield* database.db
          .insert(sessions)
          .values({
            session_id: placement.brainId,
            space_id: placement.spaceId,
            environment_id: environmentId,
          })
          .onConflictDoNothing()
          .returning({ session_id: sessions.session_id })
          .pipe(Effect.orDie)
        if (inserted.length > 0) return { directory: directoryOf(placement.brainId), isNew: true }
        const existing = yield* database.db
          .select({ environment_id: sessions.environment_id, space_id: sessions.space_id })
          .from(sessions)
          .where(eq(sessions.session_id, placement.brainId))
          .pipe(Effect.orDie)
        const found = existing.at(0)
        if (found?.environment_id === environmentId && found.space_id === placement.spaceId)
          return { directory: directoryOf(placement.brainId), isNew: false }
        return yield* new Changed({
          message: `Session ${placement.brainId} cannot change its environment or space: not supported yet`,
        })
      }),
      find: Effect.fn("Hands.find")(function* (subject: Subject) {
        const rows = yield* database.db
          .select({ environmentId: sessions.environment_id, provider: environments.provider })
          .from(sessions)
          .innerJoin(environments, eq(environments.id, sessions.environment_id))
          .where(
            and(
              eq(sessions.session_id, subject.brainId),
              eq(environments.organization_id, subject.organizationId),
              isNull(environments.archived_at),
              isEnvironmentOfSpace(sessions.space_id, sessions.environment_id),
            ),
          )
          .pipe(Effect.orDie)
        return Option.flatMap(Option.fromNullishOr(rows.at(0)), (row) =>
          Option.map(registry.get(row.provider), () => directoryOf(subject.brainId)),
        )
      }),
      unbind: Effect.fn("Hands.unbind")(function* (sessionId: Session.ID) {
        yield* database.db.delete(sessions).where(eq(sessions.session_id, sessionId)).pipe(Effect.orDie)
      }),
      access: Effect.fn("Hands.access")(function* (subject: Subject) {
        return yield* connect(subject, false)
      }),
    })
  }),
)
