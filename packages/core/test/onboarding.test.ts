import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { DateTime, Effect, Layer } from "effect"
import { Onboarding } from "../src/onboarding.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(Onboarding.layer.pipe(Layer.provideMerge(Testing.layer)))

const completedAt = (checklist: { readonly steps: ReadonlyArray<Onboarding.StepState> }, step: string) =>
  checklist.steps.find((state) => state.step === step)?.completedAt ?? null

describe("Onboarding", () => {
  it.live("keeps an organization step once, at the time it first happened, for every member", () =>
    Effect.gen(function* () {
      const onboarding = yield* Onboarding.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* Seed.actor(organizationId, "owner")
      const grace = yield* Seed.actor(organizationId, "member")
      yield* onboarding.record(organizationId, Onboarding.steps.organization.memberJoined)
      const first = completedAt((yield* onboarding.get(ada)).organization, Onboarding.steps.organization.memberJoined)
      expect(first).not.toBeNull()
      yield* Effect.all(
        [
          onboarding.record(organizationId, Onboarding.steps.organization.memberJoined),
          onboarding.record(organizationId, Onboarding.steps.organization.slackConnected),
          onboarding.record(organizationId, Onboarding.steps.organization.memberJoined),
        ],
        { concurrency: "unbounded" },
      )
      const seen = (yield* onboarding.get(grace)).organization
      expect(completedAt(seen, Onboarding.steps.organization.memberJoined)).toEqual(first)
      expect(completedAt(seen, Onboarding.steps.organization.slackConnected)).not.toBeNull()
    }),
  )

  it.live("keeps a personal step for that person only, apart from the organization's checklist", () =>
    Effect.gen(function* () {
      const onboarding = yield* Onboarding.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* Seed.actor(organizationId, "owner")
      const grace = yield* Seed.actor(organizationId, "member")
      yield* Effect.all(
        [
          onboarding.recordPersonal(ada, Onboarding.steps.personal.gmailConnected),
          onboarding.recordPersonal(ada, Onboarding.steps.personal.gmailConnected),
        ],
        { concurrency: "unbounded" },
      )
      const adas = yield* onboarding.get(ada)
      expect(completedAt(adas.personal, Onboarding.steps.personal.gmailConnected)).not.toBeNull()
      expect(adas.organization.steps.every((state) => state.completedAt === null)).toBe(true)
      expect(completedAt((yield* onboarding.get(grace)).personal, Onboarding.steps.personal.gmailConnected)).toBeNull()
    }),
  )

  it.live("does not show a step that was removed from the list, even one the organization completed", () =>
    Effect.gen(function* () {
      const onboarding = yield* Onboarding.Service
      const database = yield* Database.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* Seed.actor(organizationId, "owner")
      yield* database.db.insert(Database.Schema.onboarding).values({
        id: Onboarding.ID.create(),
        organization_id: organizationId,
        steps: {
          "retired.step": "2026-01-01T00:00:00.000Z",
          [Onboarding.steps.organization.slackConnected]: "2026-02-01T00:00:00.000Z",
        },
      })
      expect((yield* onboarding.get(ada)).organization).toEqual({
        steps: Onboarding.OrganizationStep.literals.map((step) => ({
          step,
          completedAt:
            step === Onboarding.steps.organization.slackConnected
              ? DateTime.makeUnsafe("2026-02-01T00:00:00.000Z")
              : null,
        })),
        dismissedAt: null,
      })
    }),
  )

  it.live("hides the organization's checklist for every member, and a personal one for its person only", () =>
    Effect.gen(function* () {
      const onboarding = yield* Onboarding.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* Seed.actor(organizationId, "owner")
      const grace = yield* Seed.actor(organizationId, "member")
      const first = (yield* onboarding.dismiss(ada, "organization")).organization.dismissedAt
      expect(first).not.toBeNull()
      expect((yield* onboarding.dismiss(grace, "organization")).organization.dismissedAt).toEqual(first)
      const graces = yield* onboarding.dismiss(grace, "personal")
      expect(graces.personal.dismissedAt).not.toBeNull()
      expect((yield* onboarding.get(ada)).personal.dismissedAt).toBeNull()
      expect(
        (yield* onboarding.get(yield* Seed.actor(yield* Seed.organization(), "owner"))).organization.dismissedAt,
      ).toBeNull()
    }),
  )
})
