import type { AppInfo, AppProfileInfo, AppRegistryInfo, CredentialInfo } from "@ren/client"
import { Slug } from "@ren/util/slug"

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

export type Status = "expired" | "connected" | "credits" | "missing"

export const statusLabel: Record<Status, string> = {
  expired: "Needs sign-in",
  connected: "Connected",
  credits: "Ren credits",
  missing: "Not connected",
}

export const statusAction: Record<Status, string | undefined> = {
  expired: "Reconnect",
  connected: undefined,
  credits: "Connect my own",
  missing: "Connect",
}

export const hasManaged = (app: Pick<CatalogApp, "mcps">) =>
  Object.values(app.mcps ?? {}).some((mcp) => mcp.transport.type === "managed")

export const statusOf = (app: Pick<CatalogApp, "mcps">, profiles: ReadonlyArray<AppProfile>): Status => {
  if (profiles.some((profile) => profile.items.some((item) => item.status === "reconnect"))) return "expired"
  if (profiles.some((profile) => gaps(profile).length === 0)) return "connected"
  const signedIn = new Set(
    profiles.flatMap((profile) =>
      profile.items.flatMap((item) => ("mcp" in item.item && item.status === "ok" ? [item.item.mcp] : [])),
    ),
  )
  const managed = Object.values(app.mcps ?? {}).flatMap((mcp) =>
    mcp.transport.type === "managed" ? [mcp.transport] : [],
  )
  return managed.some((transport) => !transport.replaces || !signedIn.has(transport.replaces)) ? "credits" : "missing"
}

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

export const listsSpace = (profile: AppProfile, spaceId: string) =>
  profile.allSpaces || profile.spaces.some((space) => space.id === spaceId)

export const lastSpaceWarning = (profile: AppProfile) =>
  `No other space uses “${profile.name}”. Ren keeps it in Settings while it has a sign-in, and deletes it if it has none.`

export const slugOf = (name: string) => Slug.of(name, 32)

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
  readonly brandColor: string | null
  readonly source: "registry" | "custom"
  readonly ownerSpaceId: string | null
  readonly mcps: AppInfo["mcps"] | null
  readonly skills: AppInfo["skills"] | null
  readonly listing: AppRegistryInfo["listing"] | null
}

const brandColorOf = (app: object) =>
  "brandColor" in app && typeof app.brandColor === "string" ? app.brandColor : null

export const fromApp = (app: AppInfo): CatalogApp => ({
  brandColor: brandColorOf(app),
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
  brandColor: brandColorOf(app),
  id: app.id,
  slug: app.slug,
  name: app.name,
  description: app.description,
  icon: app.icon,
  source: "registry",
  ownerSpaceId: null,
  mcps: null,
  skills: null,
  listing: app.listing,
})

export const mentionColor = (app: Pick<CatalogApp, "brandColor"> | undefined) => app?.brandColor ?? "var(--ring)"

export const isSpaceApp = (
  app: Pick<CatalogApp, "source" | "ownerSpaceId" | "name"> | undefined,
  spaces: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly factory?: { readonly agents: ReadonlyArray<unknown> } | undefined
  }>,
) =>
  app?.source === "custom" &&
  spaces.some(
    (space) =>
      space.id === app.ownerSpaceId &&
      ((space.factory?.agents.length ?? 0) > 0 || space.name.toLowerCase() === app.name.toLowerCase()),
  )
