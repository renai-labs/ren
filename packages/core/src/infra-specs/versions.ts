export * as InfraVersions from "./versions.js"

import type { Agent } from "@ren/schema/agent"
import type { App } from "@ren/schema/app"
import type { Channel } from "@ren/schema/channel"
import { Factory } from "@ren/schema/factory"
import type { Infra } from "@ren/schema/infra"
import type { OrganizationSettings } from "@ren/schema/organization-settings"
import type { Schedule } from "@ren/schema/schedule"
import type { Settings } from "@ren/schema/settings"
import { Predicate, Struct } from "effect"
import { AppValidation } from "../app/validation.js"
import { InfraApps } from "./apps.js"
import { InfraChannels } from "./channels.js"
import { InfraMemory } from "./memory.js"
import { InfraProfiles } from "./profiles.js"
import { InfraSchedules } from "./schedules.js"

export interface Source {
  readonly org: OrganizationSettings.UpdateInput
  readonly memory: Readonly<Record<string, string>>
  readonly spaces: Readonly<
    Record<
      string,
      {
        readonly name: string
        readonly description?: string
        readonly settings: Settings.Info
        readonly factory?: Infra.FactoryDeclaration
        readonly agents: Readonly<Record<string, Agent.Declaration>>
        readonly apps: Readonly<Record<string, App.Declaration>>
        readonly schedules: Readonly<Record<string, Schedule.Declaration>>
        readonly channels: Readonly<Record<string, Channel.Declaration>>
        readonly memory: Readonly<Record<string, string>>
        readonly uses: Infra.Uses
      }
    >
  >
  readonly bindings: Readonly<
    Record<
      string,
      {
        readonly channels: Readonly<Record<string, Channel.Target>>
        readonly profiles: Readonly<Record<string, ReadonlyArray<string>>>
      }
    >
  >
}

export interface Resource {
  readonly kind: Infra.Kind
  readonly value: unknown
}

export type Resources = ReadonlyMap<string, Resource>

type Decision = "same" | "write" | "remove" | "keep" | "conflict"

const listed = { listed: true }

const isDefault = (factory: Infra.FactoryDeclaration) =>
  factory.agents.length === 0 && factory.maxHandoffs === Factory.defaultMaxHandoffs

export const resources = (source: Source, live?: Resources): Resources => {
  const fallbackOf = (path: string) => {
    const value = live?.get(path)?.value
    const fallback = Predicate.isObject(value) ? value["fallback"] : undefined
    return Predicate.isBoolean(fallback) ? fallback : undefined
  }
  const spaces = Object.entries(source.spaces)
  const owned = <A>(pick: (space: Source["spaces"][string]) => Readonly<Record<string, A>>) =>
    spaces.flatMap(([slug, space]) => Object.entries(pick(space)).map(([name, value]) => ({ slug, name, value })))
  return new Map<string, Resource>([
    ["org", { kind: "organization", value: source.org }],
    ...spaces.map(([slug, space]): [string, Resource] => [
      `spaces/${slug}`,
      {
        kind: "space",
        value: {
          name: space.name,
          ...(Predicate.isString(space.description) && { description: space.description }),
          settings: space.settings,
          ...(space.factory && !isDefault(space.factory) && { factory: space.factory }),
        },
      },
    ]),
    ...owned((space) => space.agents).map((agent): [string, Resource] => [
      `spaces/${agent.slug}/agents/${agent.name}`,
      { kind: "agent", value: Struct.pick(agent.value, ["description", "isSubagent", "settings"]) },
    ]),
    ...spaces.flatMap(([slug, space]) =>
      space.uses.agents.map((name): [string, Resource] => [
        `spaces/${slug}/uses/agents/${name}`,
        { kind: "membership", value: listed },
      ]),
    ),
    ...owned((space) => space.apps).map((app): [string, Resource] => [
      InfraApps.path(app.slug, app.name),
      { kind: "app", value: InfraApps.canonical(app.value) },
    ]),
    ...owned((space) => space.schedules).map((schedule): [string, Resource] => [
      InfraSchedules.path(schedule.slug, schedule.name),
      { kind: "schedule", value: InfraSchedules.canonical(schedule.name, schedule.value) },
    ]),
    ...owned((space) => space.channels).map((channel): [string, Resource] => {
      const path = InfraChannels.path(channel.slug, channel.name)
      return [
        path,
        {
          kind: "channel",
          value: InfraChannels.canonical(channel.value, source.bindings[channel.slug]?.channels[channel.name], {
            fallback: fallbackOf(path),
          }),
        },
      ]
    }),
    ...[
      ...Object.entries(source.memory).map(([name, value]) => ({ slug: undefined, name, value })),
      ...owned((space) => space.memory),
    ].map((file): [string, Resource] => [
      InfraMemory.path(file.slug, file.name),
      { kind: "memory", value: { content: file.value } },
    ]),
    ...Object.entries(source.bindings).flatMap(([slug, bindings]) =>
      Object.entries(bindings.profiles).flatMap(([app, profiles]) =>
        profiles.map((profile): [string, Resource] => [
          InfraProfiles.path(slug, app, profile),
          { kind: "profile", value: listed },
        ]),
      ),
    ),
  ])
}

export const hash = (value: unknown) =>
  new Bun.CryptoHasher("sha256").update(AppValidation.canonical(value)).digest("hex")

export const versions = (resources: Resources) =>
  new Map([...resources].map(([path, resource]) => [path, hash(resource.value)]))

const asText = (value: unknown) => (Predicate.isString(value) ? value : JSON.stringify(value))

export const differences = (ren: unknown, folder: unknown, field = ""): Array<Infra.Value> => {
  const sides = [ren, folder]
  if (
    sides.every((side) => Predicate.isUndefined(side) || Predicate.isObject(side)) &&
    sides.some(Predicate.isObject)
  ) {
    const left = Predicate.isObject(ren) ? ren : {}
    const right = Predicate.isObject(folder) ? folder : {}
    return [...new Set([...Object.keys(left), ...Object.keys(right)])]
      .toSorted()
      .flatMap((key) => differences(left[key], right[key], field ? `${field}.${key}` : key))
  }
  if (AppValidation.canonical(ren) === AppValidation.canonical(folder)) return []
  return [
    {
      field,
      ...(!Predicate.isUndefined(ren) && { ren: asText(ren) }),
      ...(!Predicate.isUndefined(folder) && { folder: asText(folder) }),
    },
  ]
}

export const advanceLock = (
  folder: ReadonlyMap<string, string>,
  ren: ReadonlyMap<string, string>,
  locked: Readonly<Record<string, string>>,
) =>
  Object.fromEntries(
    [...new Set([...folder.keys(), ...ren.keys(), ...Object.keys(locked)])].toSorted().flatMap((path) => {
      const version = ren.get(path)
      if (folder.get(path) === version) return version ? [[path, version]] : []
      const seen = locked[path]
      return seen ? [[path, seen]] : []
    }),
  )

export const spaceOf = (path: string) => {
  const parts = path.split("/")
  const at = parts.at(0) === "deploy.yaml" ? 1 : 0
  const slug = parts.at(at + 1)
  return parts.at(at) === "spaces" && slug && parts.length > at + 2 ? `spaces/${slug}` : undefined
}

const conflictOf = (path: string, folder: Resource | undefined, ren: Resource | undefined): Array<Infra.Change> => {
  const kind = (folder ?? ren)?.kind
  if (!kind) return []
  return [
    {
      action: (folder && ren && "update") || (folder ? "create" : "archive"),
      status: "conflict",
      kind,
      path,
      fields: [],
      values: differences(ren?.value, folder?.value),
    },
  ]
}

export const planPull = (folder: Resources, ren: Resources, locked: Readonly<Record<string, string>>) => {
  const folderVersions = versions(folder)
  const renVersions = versions(ren)
  const decided = [...new Set([...folderVersions.keys(), ...renVersions.keys(), ...Object.keys(locked)])]
    .toSorted()
    .map((path): { readonly path: string; readonly decision: Decision } => {
      const version = renVersions.get(path)
      const seen = locked[path]
      if (folderVersions.get(path) === version) return { path, decision: "same" }
      if (ren.get(path)?.kind === "memory" && !folder.has(path) && folder.has(spaceOf(path) ?? "org"))
        return { path, decision: "write" }
      if (folderVersions.get(path) === seen) return { path, decision: version ? "write" : "remove" }
      if (version === seen) return { path, decision: "keep" }
      return { path, decision: "conflict" }
    })
  const byDecision = Map.groupBy(decided, (entry) => entry.decision)
  const pathsOf = (decision: Decision) => (byDecision.get(decision) ?? []).map((entry) => entry.path)
  const after = new Set(
    decided.flatMap((entry) =>
      entry.decision === "write" || (entry.decision !== "remove" && folder.has(entry.path)) ? [entry.path] : [],
    ),
  )
  const conflicted = new Set([
    ...pathsOf("conflict"),
    ...[...after].flatMap((path) => {
      const space = spaceOf(path)
      return space && !after.has(space) ? [path, space] : []
    }),
  ])
  return {
    write: pathsOf("write"),
    remove: pathsOf("remove"),
    conflicts: decided.flatMap((entry) =>
      conflicted.has(entry.path) ? conflictOf(entry.path, folder.get(entry.path), ren.get(entry.path)) : [],
    ),
    lock: Object.fromEntries(
      decided.flatMap((entry) => {
        const version =
          entry.decision === "keep" || entry.decision === "conflict" ? locked[entry.path] : renVersions.get(entry.path)
        return version ? [[entry.path, version]] : []
      }),
    ),
  }
}
