export * as Environments from "./environments.js"

import { EnvironmentToken } from "@ren/brain-api/environment-token"
import { Signature } from "@ren/brain-api/signature"
import { Database } from "@ren/db/database"
import { Brain } from "@ren/schema/brain"
import type { Auth } from "@ren/schema/auth"
import { Environment } from "@ren/schema/environment"
import type { Session } from "@ren/schema/session"
import { and, eq } from "drizzle-orm"
import { Array, Clock, Config, Context, DateTime, Duration, Effect, Layer, Option, Redacted, Schema } from "effect"

export interface Subject {
  readonly brainId: Session.ID
  readonly organizationId: Auth.OrganizationID
}

export interface Sandbox extends Schema.Schema.Type<typeof Sandbox> {}
export const Sandbox = Schema.Struct({
  id: Schema.NonEmptyString,
  url: Schema.String.check(Schema.makeFilter((url) => URL.canParse(url) || "a sandbox url must be an absolute URL")),
  generation: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  workspace: Schema.String.check(Schema.isStartingWith("/")).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("/workspace")),
  ),
}).annotate({ identifier: "Environments.Sandbox" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: Environment.ID,
  capacity: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  sandboxes: Schema.Array(Sandbox).check(
    Schema.makeFilter(
      (sandboxes) =>
        new Set(sandboxes.map((sandbox) => sandbox.id)).size === sandboxes.length || "sandbox ids must be unique",
    ),
  ),
}).annotate({ identifier: "Environments.Info" })

export const List = Schema.fromJsonString(
  Schema.Array(Info).check(
    Schema.makeFilter(
      (environments) =>
        new Set(environments.map((environment) => environment.id)).size === environments.length ||
        "environment ids must be unique",
    ),
  ),
).annotate({ identifier: "Environments.List" })

export const SigningKeys = Schema.fromJsonString(Schema.NonEmptyArray(Signature.PrivateKey)).annotate({
  identifier: "Environments.SigningKeys",
})

export class NotFound extends Schema.TaggedError<NotFound>()("Environments.NotFound", {
  message: Schema.String,
}) {}

export class Changed extends Schema.TaggedError<Changed>()("Environments.Changed", {
  message: Schema.String,
}) {}

export class Unavailable extends Schema.TaggedError<Unavailable>()("Environments.Unavailable", {
  message: Schema.String,
}) {}

export interface Binding {
  readonly location: Environment.Location
  readonly isNew: boolean
}

export interface Interface {
  readonly bind: (subject: Subject, environmentId: Environment.ID) => Effect.Effect<Binding, NotFound | Changed>
  readonly unbind: (sessionId: Session.ID) => Effect.Effect<void>
  readonly access: (subject: Subject) => Effect.Effect<Environment.Access, NotFound | Unavailable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Environments") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.all({
      environments: Config.schema(List, "ENVIRONMENTS").pipe(Config.withDefault([])),
      keys: Config.option(Config.schema(Schema.RedactedFromValue(SigningKeys), "ENVIRONMENT_KEYS")),
      lifetime: Config.Duration("ENVIRONMENT_TOKEN_LIFETIME").pipe(Config.withDefault(Duration.minutes(15))),
    })
    if (config.environments.length > 0 && Option.isNone(config.keys))
      return yield* Effect.die(new Error("ENVIRONMENTS names environments, but ENVIRONMENT_KEYS has no signing key"))
    const database = yield* Database.Service
    const table = Database.Schema.session_environment
    const configured = (id: Environment.ID) =>
      Option.fromNullishOr(config.environments.find((environment) => environment.id === id))
    const notConfigured = (id: Environment.ID) =>
      new NotFound({ message: `Environment ${id} is not in Ren’s configuration` })

    return Service.of({
      bind: Effect.fn("Environments.bind")(function* (subject: Subject, environmentId: Environment.ID) {
        if (Option.isNone(configured(environmentId))) return yield* notConfigured(environmentId)
        const location = { environmentId, directory: Environment.sessionDirectory(subject.brainId) }
        const inserted = yield* database.db
          .insert(table)
          .values({
            session_id: subject.brainId,
            organization_id: subject.organizationId,
            environment_id: environmentId,
          })
          .onConflictDoNothing()
          .returning({ session_id: table.session_id })
          .pipe(Effect.orDie)
        if (inserted.length > 0) return { location, isNew: true }
        const existing = yield* database.db
          .select({ environment_id: table.environment_id, organization_id: table.organization_id })
          .from(table)
          .where(eq(table.session_id, subject.brainId))
          .pipe(Effect.orDie)
        const found = existing.at(0)
        if (found?.environment_id === environmentId && found.organization_id === subject.organizationId)
          return { location, isNew: false }
        return yield* new Changed({
          message: `Session ${subject.brainId} cannot change its environment: not supported yet`,
        })
      }),
      unbind: Effect.fn("Environments.unbind")(function* (sessionId: Session.ID) {
        yield* database.db.delete(table).where(eq(table.session_id, sessionId)).pipe(Effect.orDie)
      }),
      access: Effect.fn("Environments.access")(function* (subject: Subject) {
        const assigned = yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const rows = yield* transaction
              .select({ environment_id: table.environment_id, sandbox_id: table.sandbox_id })
              .from(table)
              .where(and(eq(table.session_id, subject.brainId), eq(table.organization_id, subject.organizationId)))
            const row = rows.at(0)
            if (!row) return yield* new NotFound({ message: `Session ${subject.brainId} has no environment` })
            const environment = configured(row.environment_id)
            if (Option.isNone(environment)) return yield* notConfigured(row.environment_id)
            const kept = environment.value.sandboxes.find((sandbox) => sandbox.id === row.sandbox_id)
            if (kept) return { environment: environment.value, sandbox: kept }
            const sessions = yield* transaction
              .select({ sandbox_id: table.sandbox_id })
              .from(table)
              .where(eq(table.environment_id, row.environment_id))
              .for("update")
            const free = environment.value.sandboxes.find(
              (sandbox) =>
                sessions.filter((session) => session.sandbox_id === sandbox.id).length < environment.value.capacity,
            )
            if (!free)
              return yield* new Unavailable({
                message: `Every sandbox of environment ${row.environment_id} is full; Ren makes no new sandbox yet`,
              })
            yield* transaction.update(table).set({ sandbox_id: free.id }).where(eq(table.session_id, subject.brainId))
            return { environment: environment.value, sandbox: free }
          }),
        )
        const keys = yield* Option.match(config.keys, {
          onNone: () => Effect.die(new Error("ENVIRONMENT_KEYS has no signing key")),
          onSome: (found) => Effect.succeed(Redacted.value(found)),
        })
        const exp = Math.floor(((yield* Clock.currentTimeMillis) + Duration.toMillis(config.lifetime)) / 1000)
        return {
          environmentId: assigned.environment.id,
          directory: `${assigned.sandbox.workspace}/${subject.brainId}`,
          url: assigned.sandbox.url,
          token: yield* EnvironmentToken.sign(Array.headNonEmpty(keys), {
            env: assigned.environment.id,
            brain: Brain.ofSession(subject.brainId),
            exp,
          }),
          expiresAt: DateTime.makeUnsafe(exp * 1000),
          generation: assigned.sandbox.generation,
        } satisfies Environment.Access
      }),
    })
  }),
)

export const layerNone = Layer.succeed(
  Service,
  Service.of({
    bind: Effect.fn("Environments.bind")(function* (_subject: Subject, environmentId: Environment.ID) {
      return yield* new NotFound({ message: `Environment ${environmentId} is not in Ren’s configuration` })
    }),
    unbind: Effect.fn("Environments.unbind")(function* () {}),
    access: Effect.fn("Environments.access")(function* (subject: Subject) {
      return yield* new NotFound({ message: `Session ${subject.brainId} has no environment` })
    }),
  }),
)
