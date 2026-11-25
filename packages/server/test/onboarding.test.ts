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

it.live("a member imports another agent’s memory into a space’s root memory", () =>
  Effect.gen(function* () {
    const owner = yield* ApiFixture.owner()
    yield* owner.request("PUT", "/memory/file", {
      spaceId: owner.spaceId,
      path: "memory.md",
      content: "- Ship on Fridays.",
    })
    const imported = yield* owner.request("POST", "/onboarding/memory", {
      spaceId: owner.spaceId,
      content: "## Instructions\n[unknown] - Reply in short sentences.",
    })
    expect(imported.status).toBe(200)
    expect(yield* json(imported)).toMatchObject({
      personal: {
        steps: expect.arrayContaining([
          { step: Onboarding.steps.personal.memoryImported, completedAt: expect.any(String) },
        ]),
      },
    })
    const read = yield* owner.request("GET", `/memory/file?spaceId=${owner.spaceId}&path=memory.md`)
    expect(yield* json(read)).toEqual({
      path: "memory.md",
      content: "- Ship on Fridays.\n\n## Instructions\n[unknown] - Reply in short sentences.",
    })
    expect((yield* owner.request("POST", "/onboarding/memory", { spaceId: owner.spaceId, content: "" })).status).toBe(
      400,
    )
  }),
)

it.live("a member reports starring Ren, and cannot report a step that Ren checks itself", () =>
  Effect.gen(function* () {
    const owner = yield* ApiFixture.owner()
    const reported = yield* owner.request("POST", "/onboarding/report", {
      step: Onboarding.steps.personal.githubStarred,
    })
    expect(reported.status).toBe(200)
    expect(yield* json(reported)).toMatchObject({
      personal: {
        steps: expect.arrayContaining([
          { step: Onboarding.steps.personal.githubStarred, completedAt: expect.any(String) },
          { step: Onboarding.steps.personal.gmailConnected, completedAt: null },
        ]),
      },
    })
    expect(
      (yield* owner.request("POST", "/onboarding/report", { step: Onboarding.steps.personal.gmailConnected })).status,
    ).toBe(400)
  }),
)
