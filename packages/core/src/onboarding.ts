export * as Onboarding from "./onboarding.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import { Onboarding } from "@ren/schema/onboarding"
import { and, eq, isNull, or, sql } from "drizzle-orm"
import { Clock, Context, DateTime, Effect, Layer } from "effect"

export const ID = Onboarding.ID
export const steps = Onboarding.steps
export type StepState = Onboarding.StepState
export const OrganizationStep = Onboarding.OrganizationStep
export type OrganizationStep = Onboarding.OrganizationStep
export const PersonalStep = Onboarding.PersonalStep
export type PersonalStep = Onboarding.PersonalStep

export interface Person {
  readonly organizationId: Auth.OrganizationID
  readonly userId: Auth.UserID
}

export interface Interface {
  readonly record: (organizationId: Auth.OrganizationID, step: OrganizationStep) => Effect.Effect<void>
  readonly recordPersonal: (person: Person, step: PersonalStep) => Effect.Effect<void>
  readonly get: (person: Person) => Effect.Effect<Onboarding.Info>
  readonly dismiss: (person: Person, checklist: Onboarding.ChecklistKind) => Effect.Effect<Onboarding.Info>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Onboarding") {}

const table = Database.Schema.onboarding

const checklist = (
  literals: ReadonlyArray<Onboarding.Step>,
  row: { readonly steps: Readonly<Record<string, string>>; readonly dismissedAt: Date | null } | undefined,
): Onboarding.Checklist => ({
  steps: literals.map((step) => {
    const completedAt = row?.steps[step]
    return { step, completedAt: completedAt ? DateTime.fromDateUnsafe(new Date(completedAt)) : null }
  }),
  dismissedAt: row?.dismissedAt ? DateTime.fromDateUnsafe(row.dismissedAt) : null,
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service

    const record = Effect.fn("Onboarding.record")(
      function* (organizationId: Auth.OrganizationID, userId: Auth.UserID | null, step: Onboarding.Step) {
        const now = new Date(yield* Clock.currentTimeMillis)
        yield* database.db
          .insert(table)
          .values({
            id: Onboarding.ID.create(),
            organization_id: organizationId,
            user_id: userId,
            steps: { [step]: now.toISOString() },
          })
          .onConflictDoUpdate({
            target: [table.organization_id, table.user_id],
            set: { steps: sql`${table.steps} || excluded.steps`, updated_at: sql`now()` },
            setWhere: sql`not jsonb_exists(${table.steps}, ${step})`,
          })
      },
      Effect.catchCause((cause) => Effect.logWarning("An onboarding step was not recorded", cause)),
    )

    const get = Effect.fn("Onboarding.get")(function* (person: Person) {
      const rows = yield* database.db
        .select({ userId: table.user_id, steps: table.steps, dismissedAt: table.dismissed_at })
        .from(table)
        .where(
          and(
            eq(table.organization_id, person.organizationId),
            or(isNull(table.user_id), eq(table.user_id, person.userId)),
          ),
        )
        .pipe(Effect.orDie)
      return {
        organization: checklist(
          OrganizationStep.literals,
          rows.find((row) => !row.userId),
        ),
        personal: checklist(
          PersonalStep.literals,
          rows.find((row) => row.userId === person.userId),
        ),
      } satisfies Onboarding.Info
    })

    return Service.of({
      record: (organizationId, step) => record(organizationId, null, step),
      recordPersonal: (person, step) => record(person.organizationId, person.userId, step),
      get,
      dismiss: Effect.fn("Onboarding.dismiss")(function* (person: Person, kind: Onboarding.ChecklistKind) {
        yield* database.db
          .insert(table)
          .values({
            id: Onboarding.ID.create(),
            organization_id: person.organizationId,
            user_id: kind === "personal" ? person.userId : null,
            dismissed_at: sql`now()`,
          })
          .onConflictDoUpdate({
            target: [table.organization_id, table.user_id],
            set: { dismissed_at: sql`coalesce(${table.dismissed_at}, now())`, updated_at: sql`now()` },
          })
          .pipe(Effect.orDie)
        return yield* get(person)
      }),
    })
  }),
)
