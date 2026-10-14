export * as SpacePolicy from "./policy.js"

import { Auth } from "@ren/schema/auth"
import { Primitive } from "@ren/schema/primitive"
import { Space } from "@ren/schema/space"
import { Context, Layer } from "effect"
import { Actor } from "../actor.js"
import { Policy } from "../policy.js"

type Action = Primitive.Action<typeof Space.definition>

type OrganizationTargetAction = Extract<Action, "space.list" | "space.create">

export interface OrganizationContext {
  readonly role: string | undefined
}

export interface SpaceAccessContext extends OrganizationContext {
  readonly membershipId: Space.MembershipID | null
}

export interface SpaceContext extends SpaceAccessContext {
  readonly isFirstOrganizationSpace: boolean
}

export type Request =
  | {
      readonly who: Actor.Info
      readonly action: OrganizationTargetAction
      readonly target: Auth.OrganizationID
      readonly policyContext: OrganizationContext
    }
  | {
      readonly who: Actor.Info
      readonly action: Exclude<Action, OrganizationTargetAction>
      readonly target: Space.ID
      readonly policyContext: SpaceContext
    }

export interface Interface extends Policy.Interface<Request> {
  readonly visibility: (policyContext: OrganizationContext) => "organization" | "membership"
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/SpacePolicy") {}

const isAdministrator = (policyContext: OrganizationContext) =>
  Boolean(policyContext.role && Auth.isAdministrator(policyContext.role))

export const canAccess = (policyContext: SpaceAccessContext) =>
  Boolean(policyContext.role) && (isAdministrator(policyContext) || Boolean(policyContext.membershipId))

const statements: readonly Policy.Statement[] = [
  {
    id: "space.organization-member",
    scope: { kind: "global" },
    effect: "allow",
    subjects: [{ kind: "everyone" }],
    actions: [Primitive.action(Space.definition, "list"), Primitive.action(Space.definition, "create")],
    resources: [{ kind: "organization", id: "*" }],
    when: ["organization-member"],
  },
  ...(["organization-administrator", "space-member"] as const).map((condition): Policy.Statement => ({
    id: `space.${condition}`,
    scope: { kind: "global" },
    effect: "allow",
    subjects: [{ kind: "everyone" }],
    actions: [
      Primitive.action(Space.definition, "get"),
      Primitive.action(Space.definition, "update"),
      Primitive.action(Space.definition, "archive"),
    ],
    resources: [{ kind: "space", id: "*" }],
    when: ["organization-member", condition],
  })),
]

export const facts = (policyContext: OrganizationContext & { readonly membershipId?: Space.MembershipID | null }) => ({
  "organization-member": Boolean(policyContext.role),
  "organization-administrator": isAdministrator(policyContext),
  "space-member": Boolean(policyContext.membershipId),
})

const check = (request: Request): Policy.Decision => {
  const scopes = [{ kind: "organization", id: request.who.organizationId }] as const
  switch (request.action) {
    case "space.list":
    case "space.create":
      return Policy.evaluate(
        statements,
        {
          who: request.who,
          action: request.action,
          resource: { kind: "organization", id: request.target },
          scopes,
          facts: facts(request.policyContext),
        },
        request.action === "space.list"
          ? "Join the organization to see spaces."
          : "Join the organization to create spaces.",
      )
    case "space.get":
    case "space.update":
    case "space.archive":
      if (request.action === "space.archive" && request.policyContext.isFirstOrganizationSpace) {
        return Policy.deny("This space cannot be archived.")
      }
      return Policy.evaluate(
        statements,
        {
          who: request.who,
          action: request.action,
          resource: { kind: "space", id: request.target },
          scopes: [...scopes, { kind: "space", id: request.target }],
          facts: facts(request.policyContext),
        },
        {
          "space.get": "Space not found.",
          "space.update": "You cannot edit this space.",
          "space.archive": "This space cannot be archived.",
        }[request.action],
      )
  }
}

export const layer = Layer.succeed(
  Service,
  Service.of({
    check,
    visibility: (policyContext) => (isAdministrator(policyContext) ? "organization" : "membership"),
  }),
)
