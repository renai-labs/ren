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
export const Step = Onboarding.Step
export type Step = Onboarding.Step
export const ReportedStep = Onboarding.ReportedStep
export type ReportedStep = Onboarding.ReportedStep
export const appSteps = Onboarding.appSteps

export interface Person {
  readonly organizationId: Auth.OrganizationID
  readonly userId: Auth.UserID
}

export interface Interface {
  readonly record: (
    organizationId: Auth.OrganizationID,
    step: OrganizationStep,
    options?: { readonly occurrence?: string },
  ) => Effect.Effect<void>
  readonly recordPersonal: (person: Person, step: PersonalStep) => Effect.Effect<void>
  readonly get: (person: Person) => Effect.Effect<Onboarding.Info>
  readonly dismiss: (person: Person, checklist: Onboarding.ChecklistKind) => Effect.Effect<Onboarding.Info>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Onboarding") {}

export interface Completion {
  readonly organizationId: Auth.OrganizationID
  readonly userId: Auth.UserID | null
  readonly step: Onboarding.Step
  readonly occurrence: string | null
  readonly recorded: ReadonlyArray<string>
}

export interface ListenerInterface {
  readonly completed: (completion: Completion) => Effect.Effect<void>
}

export class Listener extends Context.Reference<ListenerInterface>("@ren/core/Onboarding/Listener", {
  defaultValue: () => ({ completed: () => Effect.void }),
}) {}

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
    const listener = yield* Listener

    const record = Effect.fn("Onboarding.record")(
      function* (
        organizationId: Auth.OrganizationID,
        userId: Auth.UserID | null,
        step: Onboarding.Step,
        occurrence: string | null,
      ) {
        const now = new Date(yield* Clock.currentTimeMillis).toISOString()
        const key = occurrence ? `${step}:${occurrence}` : step
        const [recorded] = yield* database.db
          .insert(table)
          .values({
            id: Onboarding.ID.create(),
            organization_id: organizationId,
            user_id: userId,
            steps: { [step]: now, [key]: now },
          })
          .onConflictDoUpdate({
            target: [table.organization_id, table.user_id],
            set: { steps: sql`excluded.steps || ${table.steps}`, updated_at: sql`now()` },
            setWhere: sql`not jsonb_exists(${table.steps}, ${key})`,
          })
          .returning({ steps: table.steps })
        return recorded ? Object.keys(recorded.steps) : null
      },
      Effect.catchCause((cause) =>
        Effect.logWarning("An onboarding step was not recorded", cause).pipe(Effect.as(null)),
      ),
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

    const appSteps: ReadonlyArray<string> = Object.values(Onboarding.appSteps)

    const notify = (completion: Completion) =>
      listener
        .completed(completion)
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("An onboarding step was recorded, but its listener failed", cause),
          ),
        )

    const complete = (
      organizationId: Auth.OrganizationID,
      userId: Auth.UserID | null,
      step: Onboarding.Step,
      occurrence: string | null,
    ): Effect.Effect<void> =>
      Effect.flatMap(record(organizationId, userId, step, occurrence), (recorded) =>
        recorded
          ? Effect.andThen(
              notify({ organizationId, userId, step, occurrence, recorded }),
              userId &&
                appSteps.includes(step) &&
                recorded.filter((key) => appSteps.includes(key)).length >= Onboarding.appsNeeded
                ? complete(organizationId, userId, Onboarding.steps.personal.appsConnected, null)
                : Effect.void,
            )
          : Effect.void,
      )

    return Service.of({
      record: (organizationId, step, options) => complete(organizationId, null, step, options?.occurrence ?? null),
      recordPersonal: (person, step) => complete(person.organizationId, person.userId, step, null),
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
