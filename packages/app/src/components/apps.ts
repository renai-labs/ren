export * as Apps from "./apps.js"

import type { AppInfo, AppProfileInfo, AppRegistryInfo, SpaceInfo } from "@ren/client"
import { Pagination } from "@ren/schema/pagination"
import { Slug } from "@ren/util/slug"
import { Search } from "@ren/util/search"
import { useQuery } from "@tanstack/react-query"
import { Profiles } from "./profiles.js"
import { Pages } from "../lib/pages.js"
import { RouterContext } from "../lib/router-context.js"

export type Entry = {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly icon: string | undefined
  readonly mcps: ReadonlyArray<{ readonly slug: string; readonly description: string }>
  readonly skills: ReadonlyArray<{ readonly slug: string; readonly description: string }>
  readonly about: string | null
  readonly prompts: ReadonlyArray<string>
  readonly source: "registry" | "custom"
}

const parts = (record: Readonly<Record<string, object>>) =>
  Object.entries(record).map(([slug, part]) => ({
    slug,
    description: "description" in part && typeof part.description === "string" ? part.description : "",
  }))

const fromRegistry = (app: AppRegistryInfo): Entry => ({
  id: app.id,
  name: app.name,
  description: app.description,
  icon: app.icon ?? undefined,
  mcps: parts(app.mcps),
  skills: parts(app.skills),
  about: app.listing.body,
  prompts: app.listing.examplePrompts,
  source: "registry",
})

const fromCustom = (app: AppInfo): Entry => ({
  id: app.id,
  name: app.name,
  description: app.description,
  icon: app.icon ?? undefined,
  mcps: parts(app.mcps),
  skills: parts(app.skills),
  about: null,
  prompts: [],
  source: "custom",
})

const stateOf = (input: { readonly failed: boolean; readonly pending: boolean }) => {
  if (input.failed) return "failed" as const
  return input.pending ? ("loading" as const) : ("ready" as const)
}

export const page = { page: 1, pageSize: Pagination.maximumPageSize }

export function useCatalog() {
  const context = RouterContext.useRouterContext()
  const custom = useQuery(Pages.all((index) => context.api.app.list.queryOptions({ ...page, page: index })))
  const registry = useQuery(
    Pages.all((index) => context.api["app-registry"].list.queryOptions({ ...page, page: index })),
  )
  const profiles = useQuery({
    ...Pages.all((index) => context.api["app-profile"].list.queryOptions({ ...page, page: index })),
    refetchOnWindowFocus: "always",
  })
  const spaces = useQuery(context.api.space.list.queryOptions(page))
  const entries = [...(custom.data?.items ?? []).map(fromCustom), ...(registry.data?.items ?? []).map(fromRegistry)]
  return {
    entries: entries.toSorted((left, right) => left.name.localeCompare(right.name)),
    profiles: Map.groupBy(profiles.data?.items ?? [], (profile) => profile.appId),
    spaces: (spaces.data?.items ?? []).filter((space) => space.membershipId),
    state: stateOf({ failed: custom.isError || registry.isError, pending: custom.isPending || registry.isPending }),
    retry: () => Promise.all([custom.refetch(), registry.refetch()]),
  }
}

export const matches = (entry: Entry, needle: string) => Search.matches([entry.name, entry.description], needle)

export const summary = (profiles: ReadonlyArray<AppProfileInfo>) => {
  const spaces = new Set(profiles.flatMap((profile) => profile.spaces.map((space) => space.id))).size
  const gaps = profiles.reduce((total, profile) => total + Profiles.gaps(profile).length, 0)
  const counted = spaces === 1 ? "1 space" : `${spaces} spaces`
  const reach = profiles.some((profile) => profile.allSpaces) ? "Every space" : counted
  return gaps ? `${reach} · ${gaps} not connected` : reach
}

export const lists = (profile: AppProfileInfo, space: Pick<SpaceInfo, "id">) =>
  profile.allSpaces || profile.spaces.some((listed) => listed.id === space.id)

export const freeSlug = (name: string, taken: ReadonlyArray<string>) =>
  Slug.free(Profiles.slugOf(name) || "space", new Set(taken), 32)

const progress = (profile: AppProfileInfo) => {
  const needed = profile.items.filter((item) => !item.optional)
  return { set: needed.filter((item) => item.status === "ok").length, total: needed.length }
}

// oxlint-disable-next-line ren/no-comments -- Where an account is used, org-wide, in ren-v1's short captions.
export const reach = (profile: AppProfileInfo) => {
  if (profile.kind === "private") return "Personal"
  if (profile.allSpaces) return "Every space"
  const names = profile.spaces.map((space) => space.name)
  const listed = [...names, ...(profile.hiddenSpaces ? [`${profile.hiddenSpaces} more`] : [])]
  return listed.length ? `In ${listed.join(", ")}` : "Not in any space"
}

// oxlint-disable-next-line ren/no-comments -- Ren deletes a shared profile when its last space goes, so the UI asks first.
export const isLastSpace = (profile: AppProfileInfo) =>
  profile.kind === "shared" && !profile.allSpaces && profile.spaces.length + profile.hiddenSpaces === 1

export const lastSpaceWarning = (profile: AppProfileInfo) =>
  `This is the last space that uses “${profile.name}”, so the account and its sign-ins are deleted.`

// oxlint-disable-next-line ren/no-comments -- ren-v1 credentialSourceLabel: where a space's access to the profile comes from.
export const source = (profile: AppProfileInfo, spaceId: string) => {
  if (profile.kind === "private") return "Personal"
  if (profile.allSpaces) return "Inherited from org"
  if (profile.spaces.some((space) => space.id === spaceId)) return "In this space"
  const from = profile.spaces.at(0)?.name
  if (from) return `From ${from}`
  return profile.hiddenSpaces ? "From another space" : "Not in any space"
}

// oxlint-disable-next-line ren/no-comments -- ren-v1 appCredentialSummary: the status when something is missing, else the source.
export const caption = (profile: AppProfileInfo, spaceId: string) => {
  const counted = progress(profile)
  if (counted.total === 0) return "No keys needed"
  if (counted.set === counted.total) return source(profile, spaceId)
  if (counted.set === 0) return "Not connected"
  return `${counted.set} of ${counted.total} keys`
}

// oxlint-disable-next-line ren/no-comments -- ren-v1 appConnectLabel: no button once every item is connected.
export const connectLabel = (profile: AppProfileInfo) => {
  const counted = progress(profile)
  if (counted.set === counted.total) return
  return counted.set === 0 ? "Connect" : `Add ${counted.total - counted.set} missing`
}
