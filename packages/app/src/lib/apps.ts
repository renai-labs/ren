import type { AppInfo, AppProfileInfo, AppRegistryInfo, CredentialInfo } from "@ren/client"

type AppProfile = AppProfileInfo
type Credential = CredentialInfo
type CredentialOwner = CredentialInfo["owner"]

const required = (profile: AppProfile) => profile.items.filter((item) => !item.optional)

export const gaps = (profile: AppProfile) => [
  ...required(profile)
    .filter((item) => item.status !== "ok")
    .map((item) => item.name),
  ...profile.links.filter((link) => link.profileId === null).map(() => "Dependency"),
  ...profile.oauthApps.filter((gate) => !gate.isConfigured).map((gate) => gate.name),
]

const countGaps = (profiles: ReadonlyArray<AppProfile>) =>
  profiles.reduce((total, profile) => total + gaps(profile).length, 0)

export const needsAttention = (profiles: ReadonlyArray<AppProfile>) => countGaps(profiles) > 0

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

export const summary = (profiles: ReadonlyArray<AppProfile>) => {
  const spaces = new Set(profiles.flatMap((profile) => profile.spaces.map((space) => space.id))).size
  const reach = profiles.some((profile) => profile.allSpaces) ? "Every space" : plural(spaces, "space")
  const missing = countGaps(profiles)
  return missing ? `${reach} · ${missing} not connected` : reach
}

export const reach = (profile: AppProfile) => {
  if (profile.kind === "private") return "Personal"
  if (profile.allSpaces) return "Every space"
  const listed = [
    ...profile.spaces.map((space) => space.name),
    ...(profile.hiddenSpaces ? [`${profile.hiddenSpaces} more`] : []),
  ]
  return listed.length ? `In ${listed.join(", ")}` : "Not in any space"
}

export const audience = (profile: AppProfile) => {
  if (profile.kind === "private") return "Only you can use this account, in your Personal Space."
  if (profile.allSpaces) return "Everyone in the organization can use this account."
  const names = profile.spaces.map((space) => space.name)
  if (names.length === 0) return "No space uses this profile yet. Add a space to share it."
  const listed = names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
  return `Everyone in ${listed}, and in the personal spaces of their members, can use this account.`
}

export const source = (profile: AppProfile, spaceId: string) => {
  if (profile.kind === "private") return "Personal"
  if (profile.allSpaces) return "Inherited from org"
  if (profile.spaces.some((space) => space.id === spaceId)) return "In this space"
  const from = profile.spaces.at(0)?.name
  if (from) return `From ${from}`
  return profile.hiddenSpaces ? "From another space" : "Not in any space"
}

const progress = (profile: AppProfile) => {
  const needed = required(profile)
  return {
    set: needed.filter((item) => item.status === "ok").length,
    total: needed.length,
  }
}

export const caption = (profile: AppProfile, spaceId: string) => {
  const counted = progress(profile)
  if (counted.total === 0) return "No keys needed"
  if (counted.set === counted.total) return source(profile, spaceId)
  if (counted.set === 0) return "Not connected"
  return `${counted.set} of ${counted.total} keys`
}

export const connectLabel = (profile: AppProfile) => {
  const counted = progress(profile)
  if (counted.set === counted.total) return
  return counted.set === 0 ? "Connect" : `Add ${counted.total - counted.set} missing`
}

export const listsSpace = (profile: AppProfile, spaceId: string) =>
  profile.allSpaces || profile.spaces.some((space) => space.id === spaceId)

export const isLastSpace = (profile: AppProfile) =>
  profile.kind === "shared" && !profile.allSpaces && profile.spaces.length + profile.hiddenSpaces === 1

export const lastSpaceWarning = (profile: AppProfile) =>
  `This is the last space that uses “${profile.name}”, so the account and its sign-ins are deleted.`

export const kinds = (from?: { members: number }) =>
  from && from.members > 1 ? (["shared"] as const) : (["shared", "private"] as const)

export const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "")

export const signsIn = (item: AppProfile["items"][number]) => item.kind === "oauth" || item.kind === "provider"

export const ownerLabel = (
  owner: CredentialOwner,
  spaces: ReadonlyArray<{ id: string; name: string }>,
  userId: string,
) => {
  if (owner.kind === "org") return "Organization"
  if (owner.kind === "space") return spaces.find((space) => space.id === owner.spaceId)?.name ?? "A space"
  if (owner.kind === "profile") return "App profile"
  return owner.userId === userId ? "You" : "Personal"
}

export const canCopy = (credential: Credential) =>
  (credential.type === "key" || credential.type === "basic" || credential.type === "fields") && !credential.account

export const anyHost = "*"

export const hostsLabel = (hosts: ReadonlyArray<string>) => (hosts.includes(anyHost) ? "Any website" : hosts.join(", "))

export const usedIn = (profiles: ReadonlyArray<AppProfile>) => {
  if (profiles.some((profile) => profile.allSpaces)) return "Every space"
  const names = new Set(
    profiles.flatMap((profile) =>
      profile.kind === "private" ? ["Personal"] : profile.spaces.map((space) => space.name),
    ),
  )
  return names.size ? [...names].join(", ") : "Not in any space"
}

export type CatalogApp = {
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly icon: string | null
  readonly source: "registry" | "custom"
  readonly ownerSpaceId: string | null
  readonly mcps: AppInfo["mcps"]
  readonly skills: AppInfo["skills"]
  readonly listing: { readonly body: string | null; readonly examplePrompts: ReadonlyArray<string> } | null
}

export const fromApp = (app: AppInfo): CatalogApp => ({
  id: app.id,
  slug: app.slug,
  name: app.name,
  description: app.description,
  icon: app.icon,
  source: app.organizationId === null ? "registry" : "custom",
  ownerSpaceId: app.ownerSpaceId,
  mcps: app.mcps,
  skills: app.skills,
  listing: null,
})

export const fromRegistry = (app: AppRegistryInfo): CatalogApp => ({
  id: app.id,
  slug: app.slug,
  name: app.name,
  description: app.description,
  icon: app.icon,
  source: "registry",
  ownerSpaceId: null,
  mcps: app.mcps,
  skills: app.skills,
  listing: { body: app.listing.body, examplePrompts: app.listing.examplePrompts },
})
