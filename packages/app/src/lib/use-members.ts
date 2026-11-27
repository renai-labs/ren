import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { organizationOptions } from "./auth.js"
import { isRole, type Role } from "./format.js"
import { useMe } from "./use-me.js"
import { RouterContext } from "./router-context.js"
import { useSpaces } from "./use-spaces.js"

export interface Member {
  readonly id: string
  readonly memberId: string
  readonly name: string
  readonly email: string
  readonly image: string | undefined
  readonly role: Role
}

export function useMembers() {
  const { auth } = RouterContext.useRouterContext()
  const me = useMe()
  const members = useSuspenseQuery({
    ...organizationOptions(auth, me.organization.id),
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

export function useRefreshMembers() {
  const { auth } = RouterContext.useRouterContext()
  const me = useMe()
  const queryClient = useQueryClient()
  return () =>
    // ast-grep-ignore: no-manual-invalidation -- members and invitations change through Better Auth
    queryClient.invalidateQueries({ queryKey: organizationOptions(auth, me.organization.id).queryKey })
}

export function useAddableSpaces() {
  const spaces = useSpaces().joined.filter((space) => space.kind === "shared" && space.canAddMember)
  const general = spaces.reduce<(typeof spaces)[number] | undefined>(
    (oldest, space) => (!oldest || space.createdAt < oldest.createdAt ? space : oldest),
    undefined,
  )
  return { spaces, general }
}
