export * as SpacePolicy from "./space-policy.js"

import { Space } from "@ren/schema/space"
import { Context, Layer } from "effect"

export interface Access {
  readonly role: string
  readonly membershipId: Space.MembershipID | null
  readonly isFirst: boolean
}

export interface Interface {
  readonly visibility: (role: string) => "organization" | "membership"
  readonly canRead: (access: Access) => boolean
  readonly canManage: (access: Access) => boolean
  readonly canManageMembers: (access: Access) => boolean
  readonly canArchive: (access: Access) => boolean
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/SpacePolicy") {}

const administrators = new Set(["owner", "admin"])

const isAdministrator = (role: string) => role.split(",").some((each) => administrators.has(each.trim()))

const canAccess = (access: Access) => Boolean(access.membershipId) || isAdministrator(access.role)

export const layer = Layer.succeed(
  Service,
  Service.of({
    visibility: (role) => (isAdministrator(role) ? "organization" : "membership"),
    canRead: canAccess,
    canManage: canAccess,
    canManageMembers: canAccess,
    canArchive: (access) => !access.isFirst && canAccess(access),
  }),
)
