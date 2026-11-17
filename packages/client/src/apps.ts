export * as Apps from "./apps.js"

import type { AppInfo, AppProfileInfo, AppRegistryInfo } from "./generated/index.js"

export type Profile = AppProfileInfo

export type Item = AppProfileInfo["items"][number]

export type Status = "expired" | "connected" | "credits" | "missing"

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
  readonly dependsOn: ReadonlyArray<string>
  readonly listing: AppRegistryInfo["listing"] | null
}

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

const required = (profile: Profile) => profile.items.filter((item) => !item.optional)

export const gaps = (profile: Profile) => [
  ...required(profile)
    .filter((item) => item.status !== "ok")
    .map((item) => item.name),
  ...profile.oauthApps.filter((gate) => !gate.isConfigured).map((gate) => gate.name),
]

export const isBundle = (app: Pick<CatalogApp, "dependsOn" | "mcps" | "skills">) =>
  app.dependsOn.length > 0 && Object.keys(app.mcps ?? {}).length === 0 && Object.keys(app.skills ?? {}).length === 0

export const waitsForUser = (status: Status | "absent") =>
  status === "missing" || status === "expired" || status === "absent"

export const listNames = (names: ReadonlyArray<string>) =>
  names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`

export const hasManaged = (app: Pick<CatalogApp, "mcps">) =>
  Object.values(app.mcps ?? {}).some((mcp) => mcp.transport.type === "managed")

export const statusOf = (app: Pick<CatalogApp, "mcps">, profiles: ReadonlyArray<Profile>): Status => {
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

export const isReady = (status: Status) => status === "connected" || status === "credits"

const rank: Record<Status, number> = { expired: 0, missing: 0, credits: 1, connected: 2 }

export const improved = (before: Status, after: Status) => rank[after] > rank[before]

export const signsIn = (item: Item) => item.kind === "oauth" || item.kind === "provider"

export const nextSignIn = (profile: Profile) => {
  const found = profile.oauthApps.every((gate) => gate.isConfigured)
    ? (profile.items.find((item) => item.status === "reconnect" && "mcp" in item.item) ??
      profile.items.find((item) => !item.optional && item.status !== "ok" && signsIn(item) && "mcp" in item.item))
    : undefined
  return found && "mcp" in found.item ? { mcp: found.item.mcp, status: found.status, name: found.name } : undefined
}

export const signsInFirst = (app: Pick<CatalogApp, "mcps">) =>
  Object.values(app.mcps ?? {}).some(
    (mcp) => mcp.transport.type !== "managed" && (mcp.auth.type === "oauth" || mcp.transport.type === "provider"),
  )

const brandColorOf = (app: object) =>
  "brandColor" in app && typeof app.brandColor === "string" ? app.brandColor : null

export const fromApp = (app: AppInfo): CatalogApp => ({
  brandColor: brandColorOf(app),
  id: app.id,
  slug: app.slug,
  name: app.name,
  description: app.description,
  icon: app.icon,
  source: app.organizationId ? "custom" : "registry",
  ownerSpaceId: app.ownerSpaceId,
  mcps: app.mcps,
  skills: app.skills,
  dependsOn: app.dependsOn ?? [],
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
  dependsOn: [],
  listing: app.listing,
})

export interface Target {
  readonly spaceId: string
  readonly private: boolean
}

export const listsSpace = (profile: Profile, spaceId: string) =>
  profile.allSpaces || profile.spaces.some((space) => space.id === spaceId)

export const reaches = (profile: Profile, target: Target, userId: string) =>
  profile.kind === "private" ? target.private && profile.userId === userId : listsSpace(profile, target.spaceId)

export const usable = (profile: Profile, target: Target, userId: string) =>
  profile.kind === "private"
    ? profile.userId === userId && !target.private
    : profile.canAdd.includes(target.private ? "ownPrivate" : "joined")

export const connectPlan = (input: {
  readonly app: Pick<CatalogApp, "mcps">
  readonly accounts: ReadonlyArray<Profile>
  readonly target: Target
  readonly userId: string
}) => {
  const here = input.accounts.filter((profile) => reaches(profile, input.target, input.userId))
  const open =
    here.find((profile) => profile.items.some((item) => item.status === "reconnect")) ??
    here.find((profile) => gaps(profile).length > 0)
  const expired = open?.items.some((item) => item.status === "reconnect") === true
  return {
    open,
    ...(!expired && {
      reuse: input.accounts.find(
        (profile) =>
          !reaches(profile, input.target, input.userId) &&
          gaps(profile).length === 0 &&
          usable(profile, input.target, input.userId),
      ),
    }),
    managed: here.length === 0 && hasManaged(input.app),
  }
}

export interface From {
  readonly spaceId: string
  readonly name: string
  readonly members: number
  readonly private?: boolean
}

export const freeSlug = (name: string, taken: ReadonlySet<string>, slugOf: (text: string) => string) => {
  const base = slugOf(name) || "account"
  if (!taken.has(base)) return base
  const number = Array.from({ length: taken.size + 1 }, (_, index) => index + 2).find(
    (candidate) => !taken.has(`${base}-${candidate}`),
  )
  return `${base}-${number}`
}

export const defaultName = (input: {
  readonly from: From | undefined
  readonly only: boolean
  readonly picked: ReadonlySet<string>
  readonly spaces: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly others: ReadonlyArray<Profile>
  readonly app: Pick<CatalogApp, "name">
  readonly user: string
}) => {
  const first = input.user.split(" ").at(0)
  if (input.only || input.from?.private) return [input.app.name, first].join(" · ")
  const targets = input.from ? [input.from.spaceId] : [...input.picked]
  const chosen = input.spaces.filter((space) => input.picked.has(space.id))
  const space = input.from?.name ?? (chosen.length === 1 ? chosen.at(0)?.name : undefined)
  const isFirst = !input.others.some(
    (other) =>
      other.kind === "shared" && (other.allSpaces || other.spaces.some((listed) => targets.includes(listed.id))),
  )
  return [space, input.app.name, isFirst ? undefined : first].filter(Boolean).join(" · ")
}
