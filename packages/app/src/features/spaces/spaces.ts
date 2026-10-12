export * as Spaces from "./spaces.js"

import type { SpaceMemberInfo } from "@ren/client"

export interface MemberRow {
  readonly id: string
  readonly status: "active" | "pending"
  readonly name: string
  readonly email: string
  readonly image: string | undefined
  readonly note?: string
}

export interface Candidate {
  readonly value: string
  readonly label: string
  readonly description: string
  readonly image: string | undefined
  readonly target: { readonly userId: string } | { readonly email: string }
  readonly added: string
}

interface Organization {
  readonly members: ReadonlyArray<{
    readonly userId: string
    readonly user: { readonly name: string; readonly email: string; readonly image?: string | null | undefined }
  }>
  readonly invitations: ReadonlyArray<{ readonly email: string; readonly status: string; readonly expiresAt: Date }>
}

export function memberRows(
  members: ReadonlyArray<SpaceMemberInfo>,
  organization: Organization | undefined,
  userId: string,
): MemberRow[] {
  const emails = new Map((organization?.members ?? []).map((member) => [member.userId, member.user.email]))
  return members.map((member) =>
    member.status === "active"
      ? {
          id: member.id,
          status: member.status,
          name: member.name,
          email: emails.get(member.userId) ?? "",
          image: member.image ?? undefined,
          ...(member.userId === userId && { note: "You" }),
        }
      : {
          id: member.id,
          status: member.status,
          name: member.email,
          email: member.email,
          image: undefined,
          note: "Invited",
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
        added: `${member.user.name || member.user.email} added to space`,
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
        added: `${invitation.email} will join when they accept their invite`,
      })),
  ]
}

export function matches(texts: ReadonlyArray<string>, query: string) {
  const needle = query.trim().toLowerCase()
  return texts.some((text) => text.toLowerCase().includes(needle))
}
