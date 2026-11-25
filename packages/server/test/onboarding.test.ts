import { expect } from "bun:test"
import { Onboarding } from "@ren/core/onboarding"
import { testEffect } from "@ren/core/testing"
import { Effect } from "effect"
import { ApiFixture } from "@ren/server/testing/api"

const it = testEffect(ApiFixture.layer)

const json = (response: Response) => Effect.promise<unknown>(() => response.json())

it.live("a member reads both onboarding checklists and hides each one", () =>
  Effect.gen(function* () {
    const owner = yield* ApiFixture.owner()
    const read = yield* owner.request("GET", "/onboarding")
    expect(read.status).toBe(200)
    expect(yield* json(read)).toEqual({
      organization: {
        steps: Onboarding.OrganizationStep.literals.map((step) => ({ step, completedAt: null })),
        dismissedAt: null,
      },
      personal: {
        steps: Onboarding.PersonalStep.literals.map((step) => ({ step, completedAt: null })),
        dismissedAt: null,
      },
    })
    const dismissed = yield* owner.request("POST", "/onboarding/dismiss", { checklist: "personal" })
    expect(dismissed.status).toBe(200)
    expect(yield* json(dismissed)).toMatchObject({
      organization: { dismissedAt: null },
      personal: { dismissedAt: expect.any(String) },
    })
    expect((yield* owner.request("POST", "/onboarding/dismiss", { checklist: "everyone" })).status).toBe(400)
  }),
)

it.live(
  "a person marks memory.imported and github.starred done themselves, but not a step Ren records or rewards",
  () =>
    Effect.gen(function* () {
      const owner = yield* ApiFixture.owner()
      for (const step of ["memory.imported", "github.starred"]) {
        const marked = yield* owner.request("POST", "/onboarding/complete", { step })
        expect(marked.status).toBe(200)
        expect(yield* json(marked)).toMatchObject({
          personal: { steps: expect.arrayContaining([{ step, completedAt: expect.any(String) }]) },
        })
      }
      for (const step of ["gmail.connected", "slack.connected", "apps.connected"])
        expect((yield* owner.request("POST", "/onboarding/complete", { step })).status).toBe(400)
    }),
)
