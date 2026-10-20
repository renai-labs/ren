export type JsonValue = null | boolean | number | string | Array<JsonValue> | { [key: string]: JsonValue }

export type HealthStatus = "ok"

export type AuthUserID = string

export type AuthOrganizationID = string

export type InvitationState = "pending" | "expired" | "accepted" | "unavailable" | "invalid"

export type SpaceID = string

export type SpaceMembershipID = string

export type SpaceAssignmentID = string

export type EnvironmentTemplateID = string

export type EnvironmentProviderID = string

export type SpaceEnvironmentTemplateID = string

export type HealthInfo = { status: HealthStatus; version: string }

export type AuthUser = {
  id: AuthUserID
  name: string
  email: string
  emailVerified: boolean
  image?: string | null | undefined
}

export type AuthOrganization = { id: AuthOrganizationID; name: string; slug: string; logo?: string | null | undefined }

export type InvitationPreview = {
  state: InvitationState
  organization: { id: AuthOrganizationID; name: string; logo: string | null } | null
  inviter: { name: string | null; email: string } | null
}

export type SpaceInfo = {
  id: SpaceID
  organizationId: AuthOrganizationID
  name: string
  description: string | null
  memberCount: number
  membershipId: SpaceMembershipID | null
  canUpdate: boolean
  canAddMember: boolean
  canRemoveMember: boolean
  canArchive: boolean
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export type SpaceMemberActive = {
  id: SpaceMembershipID
  spaceId: SpaceID
  status: "active"
  userId: AuthUserID
  name: string
  email: string
  image: string | null
  createdAt: string
  archivedAt: string | null
}

export type SpaceMemberPending = {
  id: SpaceAssignmentID
  spaceId: SpaceID
  status: "pending"
  email: string
  createdAt: string
  archivedAt: string | null
}

export type EnvironmentTemplateInfo = {
  id: EnvironmentTemplateID
  organizationId: AuthOrganizationID
  name: string
  description: string | null
  provider: EnvironmentProviderID
  config: JsonValue
  sessionsPerEnvironment: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export type EnvironmentProviderInfo = {
  id: EnvironmentProviderID
  title: string
  description: string
  configSchema: JsonValue
}

export type SpaceEnvironmentTemplateInfo = {
  id: SpaceEnvironmentTemplateID
  spaceId: SpaceID
  environmentTemplateId: EnvironmentTemplateID
  createdAt: string
  archivedAt: string | null
}

export type AuthMe = { user: AuthUser; organization: AuthOrganization | null }

export type SpacePage = { items: Array<SpaceInfo>; page: number; pageSize: number; total: number }

export type SpaceMemberInfo = SpaceMemberActive | SpaceMemberPending

export type EnvironmentTemplatePage = {
  items: Array<EnvironmentTemplateInfo>
  page: number
  pageSize: number
  total: number
}

export type EnvironmentProviderInfos = Array<EnvironmentProviderInfo>

export type SpaceEnvironmentTemplatePage = {
  items: Array<SpaceEnvironmentTemplateInfo>
  page: number
  pageSize: number
  total: number
}

export type SpaceMemberPage = { items: Array<SpaceMemberInfo>; page: number; pageSize: number; total: number }

export type UnauthorizedError = { readonly _tag: "UnauthorizedError"; readonly message: string }
export const isUnauthorizedError = (value: unknown): value is UnauthorizedError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "UnauthorizedError"

export type ForbiddenError = { readonly _tag: "ForbiddenError"; readonly message: string }
export const isForbiddenError = (value: unknown): value is ForbiddenError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ForbiddenError"

export type NotFoundError = {
  readonly _tag: "NotFoundError"
  readonly message: string
  readonly resource?: string | undefined
}
export const isNotFoundError = (value: unknown): value is NotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "NotFoundError"

export type InvalidRequestError = {
  readonly _tag: "InvalidRequestError"
  readonly message: string
  readonly field?: string | undefined
}
export const isInvalidRequestError = (value: unknown): value is InvalidRequestError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "InvalidRequestError"

export type ConflictError = {
  readonly _tag: "ConflictError"
  readonly message: string
  readonly resource?: string | undefined
}
export const isConflictError = (value: unknown): value is ConflictError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ConflictError"

export type HealthGetOutput = HealthInfo

export type MeGetOutput = AuthMe

export type InvitationPreviewInput = { readonly id: { readonly id: string }["id"] }

export type InvitationPreviewOutput = InvitationPreview

export type SpaceListInput = {
  readonly joined?: {
    readonly joined?: boolean | undefined
    readonly page: number
    readonly pageSize: number
  }["joined"]
  readonly page: { readonly joined?: boolean | undefined; readonly page: number; readonly pageSize: number }["page"]
  readonly pageSize: {
    readonly joined?: boolean | undefined
    readonly page: number
    readonly pageSize: number
  }["pageSize"]
}

export type SpaceListOutput = SpacePage

export type SpaceGetInput = { readonly idOrSlug: { readonly idOrSlug: string }["idOrSlug"] }

export type SpaceGetOutput = SpaceInfo

export type SpaceCreateInput = {
  readonly name: { readonly name: string; readonly description?: string | undefined }["name"]
  readonly description?: { readonly name: string; readonly description?: string | undefined }["description"]
}

export type SpaceCreateOutput = SpaceInfo

export type SpaceUpdateInput = {
  readonly id: { readonly id: string }["id"]
  readonly name?: { readonly name?: string | undefined; readonly description?: string | null | undefined }["name"]
  readonly description?: {
    readonly name?: string | undefined
    readonly description?: string | null | undefined
  }["description"]
}

export type SpaceUpdateOutput = SpaceInfo

export type SpaceArchiveInput = { readonly id: { readonly id: string }["id"] }

export type SpaceArchiveOutput = SpaceInfo

export type SpaceMemberListInput = {
  readonly spaceId: {
    readonly spaceId: string
    readonly status?: ("active" | "pending") | undefined
    readonly page: number
    readonly pageSize: number
  }["spaceId"]
  readonly status?: {
    readonly spaceId: string
    readonly status?: ("active" | "pending") | undefined
    readonly page: number
    readonly pageSize: number
  }["status"]
  readonly page: {
    readonly spaceId: string
    readonly status?: ("active" | "pending") | undefined
    readonly page: number
    readonly pageSize: number
  }["page"]
  readonly pageSize: {
    readonly spaceId: string
    readonly status?: ("active" | "pending") | undefined
    readonly page: number
    readonly pageSize: number
  }["pageSize"]
}

export type SpaceMemberListOutput = SpaceMemberPage

export type SpaceMemberCreateInput = {
  readonly payload:
    { readonly spaceId: string; readonly userId: string } | { readonly spaceId: string; readonly email: string }
}

export type SpaceMemberCreateOutput = SpaceMemberInfo

export type SpaceMemberArchiveInput = { readonly id: { readonly id: string | string }["id"] }

export type SpaceMemberArchiveOutput = SpaceMemberInfo

export type EnvironmentTemplateListInput = {
  readonly page: { readonly page: number; readonly pageSize: number }["page"]
  readonly pageSize: { readonly page: number; readonly pageSize: number }["pageSize"]
}

export type EnvironmentTemplateListOutput = EnvironmentTemplatePage

export type EnvironmentTemplateGetInput = { readonly idOrSlug: { readonly idOrSlug: string }["idOrSlug"] }

export type EnvironmentTemplateGetOutput = EnvironmentTemplateInfo

export type EnvironmentTemplateCreateInput = {
  readonly name: {
    readonly name: string
    readonly description?: string | null
    readonly provider: string
    readonly config: JsonValue
    readonly sessionsPerEnvironment?: number
  }["name"]
  readonly description?: {
    readonly name: string
    readonly description?: string | null
    readonly provider: string
    readonly config: JsonValue
    readonly sessionsPerEnvironment?: number
  }["description"]
  readonly provider: {
    readonly name: string
    readonly description?: string | null
    readonly provider: string
    readonly config: JsonValue
    readonly sessionsPerEnvironment?: number
  }["provider"]
  readonly config: {
    readonly name: string
    readonly description?: string | null
    readonly provider: string
    readonly config: JsonValue
    readonly sessionsPerEnvironment?: number
  }["config"]
  readonly sessionsPerEnvironment: {
    readonly name: string
    readonly description?: string | null
    readonly provider: string
    readonly config: JsonValue
    readonly sessionsPerEnvironment?: number
  }["sessionsPerEnvironment"]
}

export type EnvironmentTemplateCreateOutput = EnvironmentTemplateInfo

export type EnvironmentTemplateUpdateInput = {
  readonly id: { readonly id: string }["id"]
  readonly name?: {
    readonly name?: string | undefined
    readonly description?: string | null | undefined
    readonly config?: JsonValue | undefined
    readonly sessionsPerEnvironment?: number | undefined
  }["name"]
  readonly description?: {
    readonly name?: string | undefined
    readonly description?: string | null | undefined
    readonly config?: JsonValue | undefined
    readonly sessionsPerEnvironment?: number | undefined
  }["description"]
  readonly config?: {
    readonly name?: string | undefined
    readonly description?: string | null | undefined
    readonly config?: JsonValue | undefined
    readonly sessionsPerEnvironment?: number | undefined
  }["config"]
  readonly sessionsPerEnvironment?: {
    readonly name?: string | undefined
    readonly description?: string | null | undefined
    readonly config?: JsonValue | undefined
    readonly sessionsPerEnvironment?: number | undefined
  }["sessionsPerEnvironment"]
}

export type EnvironmentTemplateUpdateOutput = EnvironmentTemplateInfo

export type EnvironmentTemplateArchiveInput = { readonly id: { readonly id: string }["id"] }

export type EnvironmentTemplateArchiveOutput = EnvironmentTemplateInfo

export type EnvironmentProviderListOutput = EnvironmentProviderInfos

export type SpaceEnvironmentTemplateListInput = {
  readonly spaceId: { readonly spaceId: string; readonly page: number; readonly pageSize: number }["spaceId"]
  readonly page: { readonly spaceId: string; readonly page: number; readonly pageSize: number }["page"]
  readonly pageSize: { readonly spaceId: string; readonly page: number; readonly pageSize: number }["pageSize"]
}

export type SpaceEnvironmentTemplateListOutput = SpaceEnvironmentTemplatePage

export type SpaceEnvironmentTemplateCreateInput = {
  readonly spaceId: { readonly spaceId: string; readonly environmentTemplateId: string }["spaceId"]
  readonly environmentTemplateId: {
    readonly spaceId: string
    readonly environmentTemplateId: string
  }["environmentTemplateId"]
}

export type SpaceEnvironmentTemplateCreateOutput = SpaceEnvironmentTemplateInfo

export type SpaceEnvironmentTemplateArchiveInput = { readonly id: { readonly id: string }["id"] }

export type SpaceEnvironmentTemplateArchiveOutput = SpaceEnvironmentTemplateInfo
