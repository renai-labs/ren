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

const check = (request: Request): Policy.Decision => {
  switch (request.action) {
    case "space.list":
      return request.policyContext.role ? Policy.allow : Policy.deny("Join the organization to see spaces.")
    case "space.create":
      return request.policyContext.role ? Policy.allow : Policy.deny("Join the organization to create spaces.")
    case "space.get":
      return canAccess(request.policyContext) ? Policy.allow : Policy.deny("Space not found.")
    case "space.update":
      return canAccess(request.policyContext) ? Policy.allow : Policy.deny("You cannot edit this space.")
    case "space.archive":
      return canAccess(request.policyContext) && !request.policyContext.isFirstOrganizationSpace
        ? Policy.allow
        : Policy.deny("This space cannot be archived.")
  }
}

export const layer = Layer.succeed(
  Service,
  Service.of({
    check,
    visibility: (policyContext) => (isAdministrator(policyContext) ? "organization" : "membership"),
  }),
)
