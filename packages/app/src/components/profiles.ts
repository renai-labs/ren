export * as Profiles from "./profiles.js"

import type { AppProfileInfo } from "@ren/client"

export type Kind = "shared" | "private"

// oxlint-disable-next-line ren/no-comments -- private-spaces rules 10, 11: a private profile runs only in its person's private space, so a shared space offers only a shared one.
export const kinds = (from: { readonly kind: "shared" | "private" } | undefined): ReadonlyArray<Kind> =>
  from?.kind === "shared" ? ["shared"] : ["shared", "private"]

const names = (spaces: ReadonlyArray<string>) =>
  spaces.length < 2 ? spaces.join("") : `${spaces.slice(0, -1).join(", ")} and ${spaces.at(-1) ?? ""}`

// oxlint-disable-next-line ren/no-comments -- §9 rule 6 (A41, P21), private-spaces PS5: who can use an account before a sign-in into it. A shared profile reaches the spaces it lists.
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

export const gapLabel = (profiles: ReadonlyArray<AppProfileInfo>) => {
  const count = profiles.reduce((total, profile) => total + gaps(profile).length, 0)
  return count === 0 ? undefined : `${count} not connected`
}

export const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, 32)
    .replace(/-+$/u, "")
