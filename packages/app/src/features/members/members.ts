export * as Members from "./members.js"

import type { Auth } from "@ren/schema/auth"
import { Email } from "../../lib/email.js"

export type Role = Auth.Role

export type Tab = "members" | "invitations"

export const roleOptions: ReadonlyArray<{ value: Role; label: string }> = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
  { value: "owner", label: "Owner" },
]

export interface MemberRow {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly image: string | undefined
  readonly role: Role
  readonly isSelf: boolean
}

export interface InvitationRow {
  readonly id: string
  readonly email: string
  readonly role: string
  readonly expiresAt: Date
  readonly isExpired: boolean
}

export function memberRows(
  members: ReadonlyArray<{
    id: string
    role: Role
    userId: string
    user: { name: string | null; email: string | null; image?: string | null | undefined }
  }>,
  currentUserId: string,
): MemberRow[] {
  return members.map((member) => ({
    id: member.id,
    name: member.user.name ?? member.user.email ?? "Unknown user",
    email: member.user.email ?? "",
    image: member.user.image ?? undefined,
    role: member.role,
    isSelf: member.userId === currentUserId,
  }))
}

export function invitationRows(
  invitations: ReadonlyArray<{ id: string; email: string; role: string; status: string; expiresAt: Date }>,
): InvitationRow[] {
  return invitations
    .filter((invitation) => invitation.status === "pending")
    .map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: new Date(invitation.expiresAt),
      isExpired: new Date(invitation.expiresAt).getTime() < Date.now(),
    }))
}

export function search<A>(rows: ReadonlyArray<A>, query: string, fields: (row: A) => ReadonlyArray<string>) {
  const needle = query.trim().toLowerCase()
  if (needle === "") return [...rows]
  return rows.filter((row) => fields(row).some((field) => field.toLowerCase().includes(needle)))
}

export function sortBy<A>(rows: ReadonlyArray<A>, text: (row: A) => string, direction: "ascending" | "descending") {
  const sign = direction === "ascending" ? 1 : -1
  return rows.toSorted((left, right) => sign * text(left).localeCompare(text(right)))
}

export function parseEmails(input: string) {
  const entries = input
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
  return {
    valid: [...new Set(entries.filter((entry) => Email.pattern.test(entry)).map((entry) => entry.toLowerCase()))],
    invalid: [...new Set(entries.filter((entry) => !Email.pattern.test(entry)))],
  }
}

export function sequentially<A, B>(items: ReadonlyArray<A>, run: (item: A) => Promise<B>) {
  return items.reduce<Promise<ReadonlyArray<B>>>(
    async (previous, item) => [...(await previous), await run(item)],
    Promise.resolve([]),
  )
}
