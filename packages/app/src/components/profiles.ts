export * as Profiles from "./profiles.js"

import type { AppProfileInfo } from "@ren/client"
import { Slug } from "@ren/util/slug"

export type Kind = "shared" | "private"

// oxlint-disable-next-line ren/no-comments -- private-spaces rule 11: a shared space offers only shared profiles.
export const kinds = (from: { readonly kind: "shared" | "private" } | undefined): ReadonlyArray<Kind> =>
  from?.kind === "shared" ? ["shared"] : ["shared", "private"]

const names = (spaces: ReadonlyArray<string>) =>
  spaces.length < 2 ? spaces.join("") : `${spaces.slice(0, -1).join(", ")} and ${spaces.at(-1) ?? ""}`

// oxlint-disable-next-line ren/no-comments -- §9 rule 6: who can use an account before a sign-in into it.
export const audience = (profile: {
  readonly kind: Kind
  readonly allSpaces: boolean
  readonly spaces: ReadonlyArray<{ readonly name: string }>
  readonly hiddenSpaces: number
}) => {
  if (profile.kind === "private") return "Only you can use this account, in your private space."
  if (profile.allSpaces) return "Everyone in the organization can use this account."
  const shown = profile.spaces.map((space) => space.name)
  const others = profile.hiddenSpaces
  const listed = [...shown, ...(others ? [others === 1 ? "1 other space" : `${others} other spaces`] : [])]
  if (listed.length === 0) return "No space uses this profile yet. Add a space to share it."
  return `Everyone in ${names(listed)} can use this account.`
}

// oxlint-disable-next-line ren/no-comments -- §2 Gap: an item without a credential or that needs a reconnect, a missing link, or an org OAuth app that is not set up. An optional item is never a gap.
export const gaps = (profile: AppProfileInfo) => [
  ...profile.items
    .filter((item) => !item.optional && item.status !== "ok")
    .map((item) => ({ name: item.name, status: item.status })),
  ...profile.links
    .filter((link) => link.profileId === null)
    .map(() => ({ name: "Dependency", status: "missing" as const })),
  ...profile.oauthApps
    .filter((gate) => !gate.isConfigured)
    .map((gate) => ({ name: gate.name, status: "missing" as const })),
]

export const slugOf = (name: string) => Slug.of(name, 32)
