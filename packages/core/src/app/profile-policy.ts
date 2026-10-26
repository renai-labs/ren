export * as AppProfilePolicy from "./profile-policy.js"

import { Database } from "@ren/db/database"
import { AppProfile } from "@ren/schema/app-profile"
import { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import { and, eq, sql } from "drizzle-orm"
import type { Access } from "../access.js"
import { AccessFilter } from "../access-filter.js"
import type { Actor } from "../actor.js"
import { SpacePolicy } from "../space/policy.js"

export const relationships = {
  shared: "profile.shared",
  creator: "profile.creator",
  listedMember: "profile.listedMember",
  allSpaces: "profile.allSpaces",
  private: "profile.private",
  self: "profile.self",
} as const

export const actions = {
  list: Primitive.action(AppProfile.definition, "list"),
  get: Primitive.action(AppProfile.definition, "get"),
  create: Primitive.action(AppProfile.definition, "create"),
  update: Primitive.action(AppProfile.definition, "update"),
  access: Primitive.action(AppProfile.definition, "access"),
  link: Primitive.action(AppProfile.definition, "link"),
  promote: Primitive.action(AppProfile.definition, "promote"),
  connect: `${AppProfile.definition.name}.connect`,
  delete: `${AppProfile.definition.name}.delete`,
  shareEverySpace: `${AppProfile.definition.name}.shareEverySpace`,
  listInSpace: `${AppProfile.definition.name}.listInSpace`,
} as const

const every = SpacePolicy.organizationRoles

const admins = SpacePolicy.administratorRoles

const see = [actions.list, actions.get, actions.connect, actions.delete]

// oxlint-disable-next-line ren/no-comments -- profiles.md §10. Anyone who sees a shared profile connects its items and deletes it (P27, P28); its creator and admins rename it, link it and edit its list. A member lists a profile only in spaces they belong to, an admin in any space (listInSpace, checked on each space, P19); only admins share a profile with every space (P20). An admin sees a private profile's metadata and may delete it, never use it (P5).
export const documents = [
  {
    primitive: AppProfile.definition.name,
    statements: [
      { actions: [actions.create], roles: every, on: Policy.everywhere },
      { actions: [...see, actions.update, actions.link, actions.access], roles: admins, on: relationships.shared },
      { actions: see, roles: every, on: relationships.listedMember },
      { actions: see, roles: every, on: relationships.allSpaces },
      { actions: [...see, actions.update, actions.link, actions.access], roles: every, on: relationships.creator },
      {
        actions: [...see, actions.update, actions.link, actions.promote],
        roles: every,
        on: relationships.self,
      },
      { actions: [actions.list, actions.get, actions.delete], roles: admins, on: relationships.private },
      { actions: [actions.shareEverySpace, actions.listInSpace], roles: admins, on: Policy.everywhere },
      { actions: [actions.listInSpace], roles: every, on: SpacePolicy.member },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>

export interface Holds {
  readonly kind: AppProfile.Kind
  readonly isCreator: boolean
  readonly isListedMember: boolean
  readonly allSpaces: boolean
  readonly isSelf: boolean
}

export const resource = (holds: Holds): Access.Resource => ({
  relationships:
    holds.kind === "shared"
      ? [
          relationships.shared,
          ...(holds.isCreator ? [relationships.creator] : []),
          ...(holds.isListedMember ? [relationships.listedMember] : []),
          ...(holds.allSpaces ? [relationships.allSpaces] : []),
        ]
      : [relationships.private, ...(holds.isSelf ? [relationships.self] : [])],
})

const profiles = Database.Schema.app_profile
const listed = Database.Schema.app_profile_space
const members = Database.Schema.space_member

// oxlint-disable-next-line ren/no-comments -- Each relationship as a condition on app_profile, the same facts `resource` reads from one row.
export const conditions = (actor: Actor.Info) => {
  const shared = eq(profiles.kind, "shared")
  const isPrivate = eq(profiles.kind, "private")
  return new Map([
    [relationships.shared, shared],
    [relationships.creator, and(shared, eq(profiles.created_by_user_id, actor.userId))],
    [
      relationships.listedMember,
      and(
        shared,
        sql`exists (select 1 from ${listed} inner join ${members} on ${members.space_id} = ${listed.space_id} where ${listed.profile_id} = ${profiles.id} and ${members.user_id} = ${actor.userId} and ${members.archived_at} is null)`,
      ),
    ],
    [relationships.allSpaces, and(shared, eq(profiles.all_spaces, true))],
    [relationships.private, isPrivate],
    [relationships.self, and(isPrivate, eq(profiles.user_id, actor.userId))],
  ])
}

export const filter = (actor: Actor.Info, plan: Access.Plan) => AccessFilter.where(plan, conditions(actor))
