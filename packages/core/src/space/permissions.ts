export * as SpacePermissions from "./permissions.js"

import { Auth } from "@ren/schema/auth"
import { Space } from "@ren/schema/space"
import { Context, Layer } from "effect"

export interface Access {
  readonly isAdministrator: boolean
  readonly membershipId: Space.MembershipID | null
}

interface ArchiveAccess extends Access {
  readonly isFirstOrganizationSpace: boolean
}

export interface Interface {
  readonly isAdministrator: (role: string) => boolean
  readonly visibility: (isAdministrator: boolean) => "organization" | "membership"
  readonly canRead: (access: Access) => boolean
  readonly canCreate: (role: string) => boolean
  readonly canUpdate: (access: Access) => boolean
  readonly canAddMember: (access: Access) => boolean
  readonly canRemoveMember: (access: Access) => boolean
  readonly canArchive: (access: ArchiveAccess) => boolean
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/SpacePermissions") {}

const canAccess = (access: Access) => access.isAdministrator || Boolean(access.membershipId)

export const layer = Layer.succeed(
  Service,
  Service.of({
    isAdministrator: Auth.isAdministrator,
    visibility: (isAdministrator) => (isAdministrator ? "organization" : "membership"),
    canRead: canAccess,
    canCreate: (role) => Boolean(role),
    canUpdate: canAccess,
    canAddMember: canAccess,
    canRemoveMember: canAccess,
    canArchive: (access) => !access.isFirstOrganizationSpace && canAccess(access),
  }),
)
