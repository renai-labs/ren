export type HealthStatus = "ok"

export type AuthUserID = string

export type AuthOrganizationID = string

export type InvitationState = "pending" | "expired" | "accepted" | "unavailable" | "invalid"

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

export type AuthMe = { user: AuthUser; organization: AuthOrganization | null }

export type UnauthorizedError = { readonly _tag: "UnauthorizedError"; readonly message: string }
export const isUnauthorizedError = (value: unknown): value is UnauthorizedError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "UnauthorizedError"

export type HealthGetOutput = HealthInfo

export type MeGetOutput = AuthMe

export type InvitationPreviewInput = { readonly id: { readonly id: string }["id"] }

export type InvitationPreviewOutput = InvitationPreview
