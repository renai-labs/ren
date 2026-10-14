import { describe, expect, test } from "bun:test"
import { Auth } from "@ren/schema/auth"
import { Space } from "@ren/schema/space"
import { Effect, Layer } from "effect"
import { Policy } from "../src/policy.js"
import { SpaceMemberPolicy } from "../src/space/member-policy.js"
import { SpacePolicy } from "../src/space/policy.js"
import { testEffect } from "./lib/effect.js"

const actor = { userId: Auth.UserID.create(), organizationId: Auth.OrganizationID.create() }
const spaceId = Space.ID.create()
const request: Policy.Request = {
  who: actor,
  action: "space.update",
  resource: { kind: "space", id: spaceId },
  scopes: [
    { kind: "organization", id: actor.organizationId },
    { kind: "space", id: spaceId },
  ],
  facts: { "organization-member": true, "organization-administrator": false, "space-member": true },
}
const grant = {
  id: "member-edit",
  scope: { kind: "global" },
  effect: "allow",
  subjects: [{ kind: "everyone" }],
  actions: ["space.update"],
  resources: [{ kind: "space", id: "*" }],
  when: ["organization-member", "space-member"],
} satisfies Policy.Statement
const delegated = {
  ...actor,
  delegation: { agentId: "assistant", sessionId: "policy-test-session" },
}

describe("Policy.evaluate", () => {
  test("requires an explicit grant and every required fact", () => {
    expect(Policy.evaluate([], request, "Denied").allowed).toBe(false)
    expect(Policy.evaluate([grant], request, "Denied").allowed).toBe(true)
    expect(
      Policy.evaluate([grant], { ...request, facts: { ...request.facts, "space-member": false } }, "Denied").allowed,
    ).toBe(false)
    expect(Policy.evaluate([grant], { ...request, facts: {} }, "Denied").allowed).toBe(false)
  })

  test("a deny wins in either order and in either direction of the hierarchy", () => {
    const globalDeny = { ...grant, id: "global-deny", effect: "deny" } satisfies Policy.Statement
    const spaceAllow = { ...grant, scope: { kind: "space", id: spaceId } } satisfies Policy.Statement
    const spaceDeny = {
      ...globalDeny,
      id: "space-deny",
      scope: { kind: "space", id: spaceId },
    } satisfies Policy.Statement
    for (const statements of [
      [globalDeny, spaceAllow],
      [spaceAllow, globalDeny],
      [grant, spaceDeny],
      [spaceDeny, grant],
    ]) {
      expect(Policy.evaluate(statements, request, "Denied").allowed).toBe(false)
    }
    expect(Policy.evaluate([grant, spaceDeny], request, "Denied")).toEqual({
      allowed: false,
      reason: "Denied",
      statementId: "space-deny",
    })
  })

  test("matches exact scope, resource, action and accountable user", () => {
    const otherUser = Auth.UserID.create()
    const otherSpace = Space.ID.create()
    const otherOrganization = Auth.OrganizationID.create()
    const unrelated: readonly Policy.Statement[] = [
      { ...grant, scope: { kind: "space", id: otherSpace } },
      { ...grant, scope: { kind: "organization", id: otherOrganization } },
      { ...grant, resources: [{ kind: "space", id: otherSpace }] },
      { ...grant, resources: [{ kind: "organization", id: "*" }] },
      { ...grant, actions: ["space.archive"] },
      { ...grant, subjects: [{ kind: "user", id: otherUser }] },
    ]
    expect(Policy.evaluate(unrelated, request, "Denied").allowed).toBe(false)
    const denials = unrelated.map((statement): Policy.Statement => ({
      id: statement.id,
      scope: statement.scope,
      effect: "deny",
      subjects: statement.subjects,
      actions: statement.actions,
      resources: statement.resources,
    }))
    expect(Policy.evaluate([grant, ...denials], request, "Denied").allowed).toBe(true)
    expect(
      Policy.evaluate([{ ...grant, subjects: [{ kind: "user", id: actor.userId }] }], request, "Denied").allowed,
    ).toBe(true)
  })

  test("any selector in each list may match, but conditions are conjunctive", () => {
    expect(
      Policy.evaluate(
        [
          {
            ...grant,
            subjects: [{ kind: "user", id: Auth.UserID.create() }, { kind: "everyone" }],
            actions: ["space.archive", "space.update"],
            resources: [
              { kind: "organization", id: "*" },
              { kind: "space", id: spaceId },
            ],
          },
        ],
        request,
        "Denied",
      ).allowed,
    ).toBe(true)
  })

  test("missing facts cannot bypass a conditional deny", () => {
    const deny: Policy.Statement = { ...grant, id: "admin-deny", effect: "deny", when: ["organization-administrator"] }
    expect(Policy.evaluate([grant, deny], request, "Denied").allowed).toBe(true)
    expect(
      Policy.evaluate(
        [grant, deny],
        {
          ...request,
          facts: { "organization-member": true, "space-member": true },
        },
        "Denied",
      ).allowed,
    ).toBe(false)
  })

  test("delegation retains user authority and agent denies only restrict agent calls", () => {
    const agentDeny: Policy.Statement = { ...grant, id: "agent-deny", effect: "deny", subjects: [{ kind: "agent" }] }
    expect(Policy.evaluate([grant], { ...request, who: delegated }, "Denied").allowed).toBe(true)
    expect(Policy.evaluate([grant, agentDeny], request, "Denied").allowed).toBe(true)
    expect(Policy.evaluate([grant, agentDeny], { ...request, who: delegated }, "Denied")).toEqual({
      allowed: false,
      reason: "Denied",
      statementId: "agent-deny",
    })
    const agentAllow: Policy.Statement = { ...grant, subjects: [{ kind: "agent" }] }
    expect(Policy.evaluate([agentAllow], { ...request, who: delegated }, "Denied").allowed).toBe(false)
    expect(
      Policy.evaluate(
        [agentAllow, grant],
        {
          ...request,
          who: delegated,
          facts: { ...request.facts, "organization-member": false },
        },
        "Denied",
      ).allowed,
    ).toBe(false)
  })
})

const it = testEffect(Layer.mergeAll(SpacePolicy.layer, SpaceMemberPolicy.layer))

describe("Built-in policies", () => {
  it.effect("keeps visibility, membership capabilities and delegated checks aligned", () =>
    Effect.gen(function* () {
      const spaces = yield* SpacePolicy.Service
      const members = yield* SpaceMemberPolicy.Service
      const contexts = [undefined, "member", "admin", "owner", "member,admin"].flatMap((role) =>
        [null, Space.MembershipID.create()].map((membershipId) => ({
          role,
          membershipId,
          spaceId,
          isFirstOrganizationSpace: false,
        })),
      )
      for (const context of contexts) {
        const visible =
          Boolean(context.role) && (spaces.visibility(context) === "organization" || Boolean(context.membershipId))
        expect(members.canArchiveMembers(context)).toBe(visible)
        for (const who of [actor, delegated]) {
          for (const action of ["space.get", "space.update", "space.archive"] as const) {
            expect(spaces.check({ who, action, target: spaceId, policyContext: context }).allowed).toBe(visible)
          }
          for (const action of ["space.list", "space.create"] as const) {
            expect(spaces.check({ who, action, target: actor.organizationId, policyContext: context }).allowed).toBe(
              Boolean(context.role),
            )
          }
          for (const action of ["space-member.list", "space-member.create"] as const) {
            expect(members.check({ who, action, target: spaceId, policyContext: context }).allowed).toBe(visible)
          }
          expect(
            members.check({
              who,
              action: "space-member.archive",
              target: Space.MembershipID.create(),
              policyContext: context,
            }).allowed,
          ).toBe(visible)
          expect(
            members.check({
              who,
              action: "space-member.archive",
              target: Space.AssignmentID.create(),
              policyContext: context,
            }).allowed,
          ).toBe(visible)
          expect(
            spaces.check({
              who,
              action: "space.archive",
              target: spaceId,
              policyContext: { ...context, isFirstOrganizationSpace: true },
            }).allowed,
          ).toBe(false)
        }
      }
    }),
  )
})
