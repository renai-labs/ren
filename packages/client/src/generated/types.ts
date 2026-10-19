export type HealthStatus = "ok"

export type AuthUserID = string

export type AuthOrganizationID = string

export type InvitationState = "pending" | "expired" | "accepted" | "unavailable" | "invalid"

export type SpaceID = string

export type SpaceMembershipID = string

export type SpaceAssignmentID = string

export type SessionID = string

export type SessionHarness = "opencode"

export type SessionStatus = "idle" | "busy"

export type SessionCapabilitiesInfo = {
  steer: boolean
  queue: boolean
  interrupt: boolean
  model: boolean
  permissions: boolean
  forms: boolean
  revert: boolean
  fork: boolean
  compact: boolean
  shell: boolean
  commands: boolean
  rename: boolean
  files: boolean
}

export type SessionMessageID = string

export type SessionClientAccess = { url: string; token: string; expiresAt: string }

export type SessionModelVariant = { id: string }

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

export type SessionForkSource = { sessionId: SessionID; messageId: SessionMessageID }

export type SessionModelChoice = { id: string; providerID: string; name: string; variants: Array<SessionModelVariant> }

export type AuthMe = { user: AuthUser; organization: AuthOrganization | null }

export type SpacePage = { items: Array<SpaceInfo>; page: number; pageSize: number; total: number }

export type SpaceMemberInfo = SpaceMemberActive | SpaceMemberPending

export type SessionInfo = {
  id: SessionID
  spaceId: SpaceID
  createdBy: AuthUserID
  harness: SessionHarness
  title: string | null
  status: SessionStatus
  capabilities: SessionCapabilitiesInfo
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  forkedFrom: SessionForkSource | null
  unread: boolean
}

export type SpaceMemberPage = { items: Array<SpaceMemberInfo>; page: number; pageSize: number; total: number }

export type SessionPage = { items: Array<SessionInfo>; page: number; pageSize: number; total: number }

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

export type SessionListInput = {
  readonly spaceId?: {
    readonly spaceId?: string | undefined
    readonly page: number
    readonly pageSize: number
  }["spaceId"]
  readonly page: { readonly spaceId?: string | undefined; readonly page: number; readonly pageSize: number }["page"]
  readonly pageSize: {
    readonly spaceId?: string | undefined
    readonly page: number
    readonly pageSize: number
  }["pageSize"]
}

export type SessionListOutput = SessionPage

export type SessionGetInput = { readonly idOrSlug: { readonly idOrSlug: string }["idOrSlug"] }

export type SessionGetOutput = SessionInfo

export type SessionCreateInput = {
  readonly id: {
    readonly id: string
    readonly spaceId: string
    readonly message?: { readonly id: string; readonly text: string } | undefined
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | undefined
  }["id"]
  readonly spaceId: {
    readonly id: string
    readonly spaceId: string
    readonly message?: { readonly id: string; readonly text: string } | undefined
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | undefined
  }["spaceId"]
  readonly message?: {
    readonly id: string
    readonly spaceId: string
    readonly message?: { readonly id: string; readonly text: string } | undefined
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | undefined
  }["message"]
  readonly model?: {
    readonly id: string
    readonly spaceId: string
    readonly message?: { readonly id: string; readonly text: string } | undefined
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | undefined
  }["model"]
}

export type SessionCreateOutput = SessionInfo

export type SessionArchiveInput = { readonly id: { readonly id: string }["id"] }

export type SessionArchiveOutput = SessionInfo

export type ChatAccessInput = { readonly id: { readonly id: string }["id"] }

export type ChatAccessOutput = SessionClientAccess

export type ChatModelsInput = { readonly id: { readonly id: string }["id"] }

export type ChatModelsOutput = Array<SessionModelChoice>

export type ChatForkInput = {
  readonly sessionId: { readonly sessionId: string }["sessionId"]
  readonly id: { readonly id: string; readonly messageId: string }["id"]
  readonly messageId: { readonly id: string; readonly messageId: string }["messageId"]
}

export type ChatForkOutput = SessionInfo

export type ChatReadInput = { readonly sessionId: { readonly sessionId: string }["sessionId"] }

export type ChatReadOutput = SessionInfo
