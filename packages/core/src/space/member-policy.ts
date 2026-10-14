export * as SpaceMemberPolicy from "./member-policy.js"

import { Primitive } from "@ren/schema/primitive"
import { Space } from "@ren/schema/space"
import { SpaceMember } from "@ren/schema/space-member"
import { Context, Layer } from "effect"
import { Actor } from "../actor.js"
import { Policy } from "../policy.js"
import { SpacePolicy } from "./policy.js"

type Action = Primitive.Action<typeof SpaceMember.definition>

type MemberTargetAction = Extract<Action, "space-member.archive">

interface PolicyContext extends SpacePolicy.SpaceAccessContext {
  readonly spaceId: Space.ID
}

export type Request =
  | {
      readonly who: Actor.Info
      readonly action: Exclude<Action, MemberTargetAction>
      readonly target: Space.ID
      readonly policyContext: PolicyContext
    }
  | {
      readonly who: Actor.Info
      readonly action: MemberTargetAction
      readonly target: SpaceMember.ID
      readonly policyContext: PolicyContext
    }

export interface Interface extends Policy.Interface<Request> {
  readonly canArchiveMembers: (policyContext: SpacePolicy.SpaceAccessContext) => boolean
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/SpaceMemberPolicy") {}

const statements = (["organization-administrator", "space-member"] as const).map((condition): Policy.Statement => ({
  id: `space-member.${condition}`,
  scope: { kind: "global" },
  effect: "allow",
  subjects: [{ kind: "everyone" }],
  actions: [
    Primitive.action(SpaceMember.definition, "list"),
    Primitive.action(SpaceMember.definition, "create"),
    Primitive.action(SpaceMember.definition, "archive"),
  ],
  resources: [
    { kind: "space", id: "*" },
    { kind: "space-member", id: "*" },
  ],
  when: ["organization-member", condition],
}))

export const layer = Layer.succeed(
  Service,
  Service.of({
    check: (request) =>
      Policy.evaluate(
        statements,
        {
          who: request.who,
          action: request.action,
          resource:
            request.action === "space-member.archive"
              ? { kind: "space-member", id: request.target }
              : { kind: "space", id: request.target },
          scopes: [
            { kind: "organization", id: request.who.organizationId },
            { kind: "space", id: request.policyContext.spaceId },
          ],
          facts: SpacePolicy.facts(request.policyContext),
        },
        "You cannot manage the members of this space.",
      ),
    canArchiveMembers: SpacePolicy.canAccess,
  }),
)
