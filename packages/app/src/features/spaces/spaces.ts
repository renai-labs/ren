export * as Spaces from "./spaces.js"

import type { SpaceMemberInfo } from "@ren/client"
import type { SpaceMember } from "@ren/schema/space-member"

export interface MemberRow {
  readonly id: string
  readonly status: SpaceMember.Status
  readonly name: string
  readonly email: string
  readonly image: string | undefined
  readonly tag?: string
}

export interface Candidate {
  readonly value: string
  readonly label: string
  readonly description: string
  readonly image: string | undefined
  readonly target: { readonly userId: string } | { readonly email: string }
  readonly addedMessage: string
}

interface Organization {
  readonly members: ReadonlyArray<{
    readonly userId: string
    readonly user: { readonly name: string; readonly email: string; readonly image?: string | null | undefined }
  }>
  readonly invitations: ReadonlyArray<{ readonly email: string; readonly status: string; readonly expiresAt: Date }>
}

export function memberRows(members: ReadonlyArray<SpaceMemberInfo>, userId: string): MemberRow[] {
  return members.map((member) =>
    member.status === "active"
      ? {
          id: member.id,
          status: member.status,
          name: member.name,
          email: member.email,
          image: member.image ?? undefined,
          ...(member.userId === userId && { tag: "You" }),
        }
      : {
          id: member.id,
          status: member.status,
          name: member.email,
          email: member.email,
          image: undefined,
          tag: "Invited",
        },
  )
}

export function candidates(
  members: ReadonlyArray<SpaceMemberInfo>,
  organization: Organization | undefined,
): Candidate[] {
  const joined = new Set(members.map((member) => (member.status === "active" ? member.userId : member.email)))
  const now = Date.now()
  return [
    ...(organization?.members ?? [])
      .filter((member) => !joined.has(member.userId))
      .map((member) => ({
        value: member.userId,
        label: member.user.name || member.user.email,
        description: member.user.email,
        image: member.user.image ?? undefined,
        target: { userId: member.userId },
        addedMessage: `${member.user.name || member.user.email} added to space`,
      })),
    ...(organization?.invitations ?? [])
      .filter((invitation) => invitation.status === "pending")
      .map((invitation) => ({ email: invitation.email.toLowerCase(), expiresAt: invitation.expiresAt }))
      .filter((invitation) => !joined.has(invitation.email))
      .map((invitation) => ({
        value: invitation.email,
        label: invitation.email,
        description: invitation.expiresAt.getTime() < now ? "Invite expired" : "Invited",
        image: undefined,
        target: { email: invitation.email },
        addedMessage: `${invitation.email} will join when they accept their invite`,
      })),
  ]
}
