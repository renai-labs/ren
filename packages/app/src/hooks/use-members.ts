import { useSuspenseQuery } from "@tanstack/react-query"
import { organizationOptions } from "@/lib/auth"
import { isRole, type Role } from "@/lib/format"
import { useMe } from "@/hooks/use-me"

export interface Member {
  readonly id: string
  readonly memberId: string
  readonly name: string
  readonly email: string
  readonly image: string | undefined
  readonly role: Role
}

export function useMembers() {
  const me = useMe()
  const members = useSuspenseQuery({
    ...organizationOptions(me.organization.id),
    select: (organization) =>
      organization.members.map((member): Member => ({
        id: member.userId,
        memberId: member.id,
        name: member.user.name || member.user.email,
        email: member.user.email,
        image: member.user.image ?? undefined,
        role: member.role.split(",").find(isRole) ?? "member",
      })),
  }).data
  const byId = new Map(members.map((member) => [member.id, member]))
  return { members, member: (userId: string | null | undefined) => (userId ? byId.get(userId) : undefined) }
}
