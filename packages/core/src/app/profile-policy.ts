export * as AppProfilePolicy from "./profile-policy.js"

import { AppProfile } from "@ren/schema/app-profile"
import type { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import type { Access } from "../access.js"
import { SpacePolicy } from "../space/policy.js"

export const facts = {
  shared: "profile.shared",
  creator: "profile.creator",
  listedMember: "profile.listedMember",
  allSpaces: "profile.allSpaces",
  private: "profile.private",
  self: "profile.self",
  targetMember: "target.member",
  targetPrivate: "target.private",
  targetShared: "target.shared",
  targetOwnPrivate: "target.ownPrivate",
  linkPrivate: "link.private",
  linkForeign: "link.foreign",
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
  addSpace: `${AppProfile.definition.name}.addSpace`,
  removeSpace: `${AppProfile.definition.name}.removeSpace`,
  allSpaces: `${AppProfile.definition.name}.allSpaces`,
  seeSpace: `${AppProfile.definition.name}.seeSpace`,
} as const

const every = SpacePolicy.organizationRoles

const admins = SpacePolicy.administratorRoles

const see = [actions.list, actions.get, actions.connect, actions.delete]

const manage = [actions.update, actions.link, actions.access]

// oxlint-disable-next-line ren/no-comments -- profiles.md §10, access §9 (AC13-AC15), private-spaces PS4, PS5, PS9. Anyone who sees a shared profile connects its items and deletes it; its creator and admins rename and link it. Its creator changes its list for spaces they are in; admins add any shared space and remove any space. Anyone who sees it adds their own private space; the creator removes any private space. Only admins choose every space. An admin sees a private profile's metadata and deletes it, never uses it. A shared profile never links a private profile, and a private profile links only its person's own.
export const documents = [
  {
    resource: AppProfile.definition.name,
    rules: [
      { actions: [actions.create], effect: "allow", roles: every, when: [] },
      { actions: [...see, ...manage], effect: "allow", roles: admins, when: [facts.shared] },
      { actions: see, effect: "allow", roles: every, when: [facts.listedMember] },
      { actions: see, effect: "allow", roles: every, when: [facts.allSpaces] },
      { actions: [...see, ...manage], effect: "allow", roles: every, when: [facts.creator] },
      {
        actions: [...see, actions.update, actions.link, actions.promote],
        effect: "allow",
        roles: every,
        when: [facts.self],
      },
      { actions: [actions.list, actions.get, actions.delete], effect: "allow", roles: admins, when: [facts.private] },
      { actions: [actions.access], effect: "allow", roles: every, when: [facts.listedMember] },
      { actions: [actions.access], effect: "allow", roles: every, when: [facts.allSpaces] },
      { actions: [actions.addSpace], effect: "allow", roles: admins, when: [facts.shared, facts.targetShared] },
      { actions: [actions.removeSpace], effect: "allow", roles: admins, when: [facts.shared] },
      {
        actions: [actions.addSpace, actions.removeSpace],
        effect: "allow",
        roles: every,
        when: [facts.creator, facts.targetMember],
      },
      {
        actions: [actions.addSpace],
        effect: "allow",
        roles: every,
        when: [facts.listedMember, facts.targetOwnPrivate],
      },
      { actions: [actions.addSpace], effect: "allow", roles: every, when: [facts.allSpaces, facts.targetOwnPrivate] },
      { actions: [actions.removeSpace], effect: "allow", roles: every, when: [facts.creator, facts.targetPrivate] },
      { actions: [actions.removeSpace], effect: "allow", roles: every, when: [facts.targetOwnPrivate] },
      { actions: [actions.allSpaces], effect: "allow", roles: admins, when: [facts.shared] },
      { actions: [actions.seeSpace], effect: "allow", roles: admins, when: [] },
      { actions: [actions.seeSpace], effect: "allow", roles: every, when: [facts.targetMember] },
      {
        actions: [actions.access, actions.addSpace, actions.removeSpace, actions.allSpaces],
        effect: "deny",
        roles: every,
        when: [facts.private],
      },
      { actions: [actions.link], effect: "deny", roles: every, when: [facts.shared, facts.linkPrivate] },
      { actions: [actions.link], effect: "deny", roles: every, when: [facts.linkForeign] },
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

export interface Target {
  readonly isMember: boolean
  readonly isPrivate: boolean
  readonly isOwnPrivate: boolean
}

export interface Link {
  readonly isPrivate: boolean
  readonly isForeign: boolean
}

const holdFacts = (holds: Holds) =>
  holds.kind === "private"
    ? [facts.private, ...(holds.isSelf ? [facts.self] : [])]
    : [
        facts.shared,
        ...(holds.isCreator ? [facts.creator] : []),
        ...(holds.isListedMember ? [facts.listedMember] : []),
        ...(holds.allSpaces ? [facts.allSpaces] : []),
      ]

const targetFacts = (target: Target) => [
  target.isPrivate ? facts.targetPrivate : facts.targetShared,
  ...(target.isMember ? [facts.targetMember] : []),
  ...(target.isOwnPrivate ? [facts.targetOwnPrivate] : []),
]

const linkFacts = (link: Link) => [
  ...(link.isPrivate ? [facts.linkPrivate] : []),
  ...(link.isForeign ? [facts.linkForeign] : []),
]

export const resource = (
  holds: Holds,
  options: { readonly target?: Target; readonly link?: Link } = {},
): Access.Resource => ({
  facts: [
    ...holdFacts(holds),
    ...(options.target ? targetFacts(options.target) : []),
    ...(options.link ? linkFacts(options.link) : []),
  ],
})
