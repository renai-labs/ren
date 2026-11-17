import { Apps, type AppProfileInfo, type CredentialInfo } from "@ren/client"
import { Slug } from "@ren/util/slug"

type AppProfile = AppProfileInfo
type Credential = CredentialInfo
type CredentialOwner = CredentialInfo["owner"]

export type Status = Apps.Status
export type CatalogApp = Apps.CatalogApp

export const statusLabel = Apps.statusLabel
export const statusAction = Apps.statusAction
export const gaps = Apps.gaps
export const hasManaged = Apps.hasManaged
export const isBundle = Apps.isBundle
export const waitsForUser = Apps.waitsForUser
export const listNames = Apps.listNames
export const statusOf = Apps.statusOf
export const signsIn = Apps.signsIn
export const fromApp = Apps.fromApp
export const fromRegistry = Apps.fromRegistry

const countGaps = (profiles: ReadonlyArray<AppProfile>) =>
  profiles.reduce((total, profile) => total + gaps(profile).length, 0)

export const needsAttention = (profiles: ReadonlyArray<AppProfile>) => countGaps(profiles) > 0

export const reachedSpaces = (profile: AppProfile) => {
  if (profile.kind === "private") return ["Personal"]
  if (profile.allSpaces) return ["Every space"]
  return [
    ...profile.spaces.map((space) => space.name),
    ...(profile.hiddenSpaces ? [`${profile.hiddenSpaces} more`] : []),
  ]
}

export const source = (profile: AppProfile, spaceId: string) => {
  if (profile.kind === "private") return "Personal"
  if (profile.allSpaces) return "Inherited from org"
  if (profile.spaces.some((space) => space.id === spaceId)) return "In this space"
  const from = profile.spaces.at(0)?.name
  if (from) return `From ${from}`
  return profile.hiddenSpaces ? "From another space" : "Not in any space"
}

export const categoryLabel = (slug: string) => slug.charAt(0).toUpperCase() + slug.slice(1).replaceAll("-", " ")

export const listsSpace = Apps.listsSpace

export const lastSpaceWarning = (profile: AppProfile) =>
  `No other space uses “${profile.name}”. Ren keeps it in Settings while it has a sign-in, and deletes it if it has none.`

export const slugOf = (name: string) => Slug.of(name, 32)

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

export const mentionColor = (app: Pick<CatalogApp, "brandColor"> | undefined) => app?.brandColor ?? "var(--ring)"
