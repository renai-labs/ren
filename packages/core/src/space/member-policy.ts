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

export type Request =
  | {
      readonly who: Actor.Info
      readonly action: Exclude<Action, MemberTargetAction>
      readonly target: Space.ID
      readonly policyContext: SpacePolicy.SpaceAccessContext
    }
  | {
      readonly who: Actor.Info
      readonly action: MemberTargetAction
      readonly target: SpaceMember.ID
      readonly policyContext: SpacePolicy.SpaceAccessContext
    }

export interface Interface extends Policy.Interface<Request> {
  readonly canArchiveMembers: (policyContext: SpacePolicy.SpaceAccessContext) => boolean
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/SpaceMemberPolicy") {}

const decide = (policyContext: SpacePolicy.SpaceAccessContext) =>
  SpacePolicy.canAccess(policyContext) ? Policy.allow : Policy.deny("You cannot manage the members of this space.")

export const layer = Layer.succeed(
  Service,
  Service.of({
    check: (request) => decide(request.policyContext),
    canArchiveMembers: (policyContext) => decide(policyContext).allowed,
  }),
)
