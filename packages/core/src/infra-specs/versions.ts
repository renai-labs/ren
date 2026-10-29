export * as InfraVersions from "./versions.js"

import { Agent } from "@ren/schema/agent"
import type { App } from "@ren/schema/app"
import type { Channel } from "@ren/schema/channel"
import { Factory } from "@ren/schema/factory"
import { Infra } from "@ren/schema/infra"
import { OrganizationSettings } from "@ren/schema/organization-settings"
import type { Schedule } from "@ren/schema/schedule"
import type { Settings } from "@ren/schema/settings"
import { Predicate, Schema } from "effect"
import { AppValidation } from "../app/validation.js"
import { InfraApps } from "./apps.js"
import { InfraChannels } from "./channels.js"
import { InfraSchedules } from "./schedules.js"

export interface Source {
  readonly org: OrganizationSettings.UpdateInput
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

const SpaceFields = Schema.Struct({
  name: Infra.SpaceDeclaration.fields.name,
  description: Infra.SpaceDeclaration.fields.description,
  settings: Infra.SpaceDeclaration.fields.settings,
  factory: Infra.SpaceDeclaration.fields.factory,
})

const listed = { listed: true }

const isDefault = (factory: Infra.FactoryDeclaration) =>
  factory.agents.length === 0 && factory.maxHandoffs === Factory.defaultMaxHandoffs

const isFields = (value: unknown): value is Readonly<Record<string, unknown>> =>
  Predicate.isObject(value) && !Array.isArray(value)

export const resources = (source: Source, live?: Resources): Resources => {
  const fallbackOf = (path: string) => {
    const value = live?.get(path)?.value
    const fallback = isFields(value) ? value["fallback"] : undefined
    return Predicate.isBoolean(fallback) ? fallback : undefined
  }
  const spaces = Object.entries(source.spaces)
  const owned = <A>(pick: (space: Source["spaces"][string]) => Readonly<Record<string, A>>) =>
    spaces.flatMap(([slug, space]) => Object.entries(pick(space)).map(([name, value]) => ({ slug, name, value })))
  return new Map<string, Resource>([
    ["org", { kind: "organization", value: Schema.encodeSync(OrganizationSettings.UpdateInput)(source.org) }],
    ...spaces.map(([slug, space]): [string, Resource] => [
      `spaces/${slug}`,
      {
        kind: "space",
        value: Schema.encodeSync(SpaceFields)({
          name: space.name,
          ...(Predicate.isString(space.description) && { description: space.description }),
          settings: space.settings,
          ...(space.factory && !isDefault(space.factory) && { factory: space.factory }),
        }),
      },
    ]),
    ...owned((space) => space.agents).map((agent): [string, Resource] => [
      `spaces/${agent.slug}/agents/${agent.name}`,
      { kind: "agent", value: Schema.encodeSync(Agent.Declaration)(agent.value) },
    ]),
    ...spaces.flatMap(([slug, space]) =>
      space.uses.agents.map((name): [string, Resource] => [
        `spaces/${slug}/uses/agents/${name}`,
        { kind: "membership", value: listed },
      ]),
    ),
    ...owned((space) => space.apps).map((app): [string, Resource] => [
      `spaces/${app.slug}/apps/${app.name}`,
      { kind: "app", value: InfraApps.canonical(app.value) },
    ]),
    ...owned((space) => space.schedules).map((schedule): [string, Resource] => [
      `spaces/${schedule.slug}/schedules/${schedule.name}`,
      { kind: "schedule", value: InfraSchedules.canonical(schedule.name, schedule.value) },
    ]),
    ...owned((space) => space.channels).map((channel): [string, Resource] => {
      const path = `spaces/${channel.slug}/channels/${channel.name}`
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
    ...Object.entries(source.bindings).flatMap(([slug, bindings]) =>
      Object.entries(bindings.profiles).flatMap(([app, profiles]) =>
        profiles.map((profile): [string, Resource] => [
          `deploy.yaml/spaces/${slug}/profiles/${app}/${profile}`,
          { kind: "profile", value: listed },
        ]),
      ),
    ),
  ])
}

export const versions = (resources: Resources) =>
  new Map(
    [...resources].map(([path, resource]) => [
      path,
      new Bun.CryptoHasher("sha256").update(AppValidation.canonical(resource.value)).digest("hex"),
    ]),
  )

const text = (value: unknown) => (Predicate.isString(value) ? value : JSON.stringify(value))

export const values = (ren: unknown, folder: unknown, field = ""): Array<Infra.Value> => {
  const sides = [ren, folder]
  if (sides.every((side) => Predicate.isUndefined(side) || isFields(side)) && sides.some(isFields)) {
    const left = isFields(ren) ? ren : {}
    const right = isFields(folder) ? folder : {}
    return [...new Set([...Object.keys(left), ...Object.keys(right)])]
      .toSorted()
      .flatMap((key) => values(left[key], right[key], field ? `${field}.${key}` : key))
  }
  if (AppValidation.canonical(ren) === AppValidation.canonical(folder)) return []
  return [
    {
      field,
      ...(!Predicate.isUndefined(ren) && { ren: text(ren) }),
      ...(!Predicate.isUndefined(folder) && { folder: text(folder) }),
    },
  ]
}

export const next = (
  folder: ReadonlyMap<string, string>,
  live: ReadonlyMap<string, string>,
  lock: Readonly<Record<string, string>>,
) =>
  Object.fromEntries(
    [...new Set([...folder.keys(), ...live.keys(), ...Object.keys(lock)])].toSorted().flatMap((path) => {
      const version = live.get(path)
      if (folder.get(path) === version) return version ? [[path, version]] : []
      const seen = lock[path]
      return seen ? [[path, seen]] : []
    }),
  )

export const spaceOf = (path: string) => {
  const slug = /^(?:deploy\.yaml\/)?spaces\/([^/]+)\//u.exec(path)?.at(1)
  return slug ? `spaces/${slug}` : undefined
}

const conflict = (path: string, folder: Resource | undefined, live: Resource | undefined): Array<Infra.Change> => {
  const kind = (folder ?? live)?.kind
  if (!kind) return []
  return [
    {
      action: (folder && live && "update") || (folder ? "create" : "archive"),
      status: "conflict",
      kind,
      path,
      fields: [],
      values: values(live?.value, folder?.value),
    },
  ]
}

export const merge = (folder: Resources, live: Resources, lock: Readonly<Record<string, string>>) => {
  const mine = versions(folder)
  const theirs = versions(live)
  const decided = [...new Set([...mine.keys(), ...theirs.keys(), ...Object.keys(lock)])].toSorted().map((path) => {
    const version = theirs.get(path)
    const seen = lock[path]
    if (mine.get(path) === version) return { path, decision: "same" as const }
    if (mine.get(path) === seen) return { path, decision: version ? ("write" as const) : ("remove" as const) }
    if (version === seen) return { path, decision: "keep" as const }
    return { path, decision: "conflict" as const }
  })
  const after = new Set(
    decided.flatMap((entry) => {
      if (entry.decision === "write") return [entry.path]
      if (entry.decision === "remove") return []
      return mine.has(entry.path) ? [entry.path] : []
    }),
  )
  const conflicted = new Set([
    ...decided.flatMap((entry) => (entry.decision === "conflict" ? [entry.path] : [])),
    ...[...after].flatMap((path) => {
      const space = spaceOf(path)
      return space && !after.has(space) ? [path, space] : []
    }),
  ])
  return {
    write: decided.flatMap((entry) => (entry.decision === "write" ? [entry.path] : [])),
    remove: decided.flatMap((entry) => (entry.decision === "remove" ? [entry.path] : [])),
    conflicts: decided.flatMap((entry) =>
      conflicted.has(entry.path) ? conflict(entry.path, folder.get(entry.path), live.get(entry.path)) : [],
    ),
    lock: Object.fromEntries(
      decided.flatMap((entry) => {
        const version =
          entry.decision === "keep" || entry.decision === "conflict" ? lock[entry.path] : theirs.get(entry.path)
        return version ? [[entry.path, version]] : []
      }),
    ),
  }
}
