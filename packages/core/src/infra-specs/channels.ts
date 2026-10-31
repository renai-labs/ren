export * as InfraChannels from "./channels.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import type { Agent } from "@ren/schema/agent"
import { Channel } from "@ren/schema/channel"
import type { ChannelInstall } from "@ren/schema/channel-install"
import type { ChannelMapping } from "@ren/schema/channel-mapping"
import type { Infra } from "@ren/schema/infra"
import type { Space } from "@ren/schema/space"
import { Slug } from "@ren/util/slug"
import { and, asc, eq, isNull } from "drizzle-orm"
import { Effect } from "effect"
import { ChannelMappings } from "../channel-mappings.js"
import { Primitive } from "../primitive.js"
import { InfraPlan } from "./plan.js"

type Provider = "github" | "slack"

export interface LiveMapping {
  readonly id: ChannelMapping.ID
  readonly installId: ChannelInstall.ID
  readonly provider: Provider
  readonly place: string
  readonly placeName: string
  readonly spaceId: Space.ID
  readonly agentId: Agent.ID | null
  readonly fallback: boolean
  readonly triggers: ReadonlyArray<Channel.TriggerSetting>
}

export interface Live {
  readonly installs: ReadonlyArray<{ readonly id: ChannelInstall.ID; readonly provider: Provider }>
  readonly mappings: ReadonlyArray<LiveMapping>
}

const maximumSlugLength = 64

const isApplied = (provider: Channel.Provider): provider is Provider => provider === "github" || provider === "slack"

export const path = (space: string, slug: string) => `spaces/${space}/channels/${slug}`

const bindingPath = (space: string, slug: string) => `deploy.yaml/spaces/${space}/channels/${slug}`

const placeKey = (installId: ChannelInstall.ID, provider: Provider, place: string) =>
  `${installId}/${provider === "github" ? place.toLowerCase() : place}`

export const canonical = (
  declaration: Channel.Declaration,
  target: Channel.Target | undefined,
  options: { readonly fallback: boolean | undefined },
) => {
  const kept = declaration.fallback ?? options.fallback
  return {
    kind: declaration.kind,
    ...(declaration.agent && { agent: declaration.agent }),
    ...(typeof kept === "boolean" && { fallback: kept }),
    triggers: Object.fromEntries(
      Object.entries(declaration.triggers ?? {}).map(([id, trigger]) => [id, trigger.prompt ?? null]),
    ),
    ...(target && {
      target: target.kind === "github" ? { kind: target.kind, repository: target.repository.toLowerCase() } : target,
    }),
  }
}

const sorted = (triggers: ReadonlyArray<Channel.TriggerSetting>) =>
  triggers
    .toSorted((left, right) => left.id.localeCompare(right.id))
    .map((trigger) => [trigger.id, trigger.prompt ?? null])

const sameTriggers = (left: ReadonlyArray<Channel.TriggerSetting>, right: ReadonlyArray<Channel.TriggerSetting>) =>
  JSON.stringify(sorted(left)) === JSON.stringify(sorted(right))

const named = (live: Live) =>
  [...Map.groupBy(live.mappings, (mapping) => mapping.spaceId).values()]
    .flatMap((mappings) => {
      const taken = new Set<string>()
      return mappings
        .toSorted(
          (left, right) => left.placeName.localeCompare(right.placeName) || left.place.localeCompare(right.place),
        )
        .map((mapping) => {
          const slug = Slug.free(
            Slug.of(mapping.placeName, maximumSlugLength) || mapping.provider,
            taken,
            maximumSlugLength,
          )
          taken.add(slug)
          return { mapping, slug }
        })
    })
    .toSorted((left, right) => left.slug.localeCompare(right.slug))

export const load = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  organizationId: Auth.OrganizationID,
) {
  const installs = yield* transaction
    .select({ id: Database.Schema.channel_install.id, provider: Database.Schema.channel_install.provider })
    .from(Database.Schema.channel_install)
    .where(eq(Database.Schema.channel_install.organization_id, organizationId))
    .orderBy(asc(Database.Schema.channel_install.provider))
  const rows = yield* transaction
    .select({
      mapping: Database.Schema.channel_mapping,
      provider: Database.Schema.channel_install.provider,
      agentOrganizationId: Database.Schema.agent.organization_id,
    })
    .from(Database.Schema.channel_mapping)
    .innerJoin(
      Database.Schema.channel_install,
      eq(Database.Schema.channel_install.id, Database.Schema.channel_mapping.install_id),
    )
    .innerJoin(Database.Schema.space, eq(Database.Schema.space.id, Database.Schema.channel_mapping.space_id))
    .leftJoin(Database.Schema.agent, eq(Database.Schema.agent.id, Database.Schema.channel_mapping.agent_id))
    .where(
      and(
        eq(Database.Schema.channel_install.organization_id, organizationId),
        isNull(Database.Schema.space.archived_at),
      ),
    )
    .orderBy(asc(Database.Schema.channel_mapping.place_name), asc(Database.Schema.channel_mapping.id))
  return {
    installs: installs.flatMap((install) =>
      isApplied(install.provider) ? [{ id: install.id, provider: install.provider }] : [],
    ),
    mappings: rows.flatMap((row): Array<LiveMapping> => {
      const provider = row.provider
      if (!isApplied(provider)) return []
      return [
        {
          id: row.mapping.id,
          installId: row.mapping.install_id,
          provider,
          place: row.mapping.place,
          placeName: row.mapping.place_name,
          spaceId: row.mapping.space_id,
          agentId: row.agentOrganizationId ? row.mapping.agent_id : null,
          fallback: row.mapping.fallback,
          triggers: row.mapping.triggers.map((trigger) =>
            trigger.prompt ? { id: trigger.id, prompt: trigger.prompt } : { id: trigger.id },
          ),
        },
      ]
    }),
  } satisfies Live
})

export const make = Effect.gen(function* () {
  const channelMappings = yield* ChannelMappings.Service

  const placeOf = (
    actor: InfraPlan.Context["actor"],
    installId: ChannelInstall.ID,
    repository: string,
  ): Effect.Effect<string, InfraPlan.Failure> => {
    const page = (number: number): Effect.Effect<string, InfraPlan.Failure> =>
      channelMappings.places(actor, { installId, page: number, pageSize: 100 }).pipe(
        Effect.catchTag("ChannelProvider.Unavailable", () =>
          Effect.fail(new Primitive.Conflict({ message: "GitHub did not answer. Try again." })),
        ),
        Effect.flatMap((found) => {
          const place = found.items.find((item) => item.name.toLowerCase() === repository.toLowerCase())
          if (place) return Effect.succeed(place.id)
          if (number * found.pageSize >= found.total)
            return Effect.fail(
              new Primitive.Invalid({
                message: `The Ren GitHub app cannot see ${repository}. Give it access to the repository.`,
                field: "repository",
              }),
            )
          return page(number + 1)
        }),
      )
    return page(1)
  }

  const diff = (
    context: InfraPlan.Context,
    live: Live,
  ): InfraPlan.Planned & { readonly aliases: ReadonlyMap<ChannelMapping.ID, string> } => {
    const problems: Array<Infra.Problem> = []
    const installs = new Map(live.installs.map((install) => [install.provider, install]))
    const pulled = new Map(named(live).map((entry) => [entry.mapping.id, entry.slug]))
    const byPlace = new Map(
      live.mappings.map((mapping) => [
        placeKey(
          mapping.installId,
          mapping.provider,
          mapping.provider === "github" ? mapping.placeName : mapping.place,
        ),
        mapping,
      ]),
    )
    const declared = context.spaces.flatMap((space) =>
      Object.entries(space.declaration.channels).map(([slug, declaration]) => ({ space, slug, declaration })),
    )
    problems.push(
      ...context.spaces.flatMap((space) =>
        Object.keys(space.bindings?.channels ?? {})
          .filter((slug) => !(slug in space.declaration.channels))
          .map((slug) => ({
            path: bindingPath(space.slug, slug),
            message: `spaces/${space.slug}/channels.yaml declares no channel “${slug}”.`,
          })),
      ),
    )

    const resolved = declared.flatMap((entry) => {
      const declaration = entry.declaration
      const target = entry.space.bindings?.channels[entry.slug]
      const title = Channel.titles[declaration.kind]
      if (!target) {
        problems.push({
          path: bindingPath(entry.space.slug, entry.slug),
          message: `Bind channel “${entry.slug}” to a ${title} place in deploy.yaml.`,
        })
        return []
      }
      if (target.kind !== declaration.kind) {
        problems.push({
          path: bindingPath(entry.space.slug, entry.slug),
          message: `deploy.yaml binds a ${Channel.titles[target.kind]} place, but channel “${entry.slug}” is a ${title} channel.`,
        })
        return []
      }
      const install = installs.get(declaration.kind)
      if (!install) {
        problems.push({
          path: path(entry.space.slug, entry.slug),
          message: `Install the ${title} app in Ren first, then plan again.`,
        })
        return []
      }
      const key = placeKey(install.id, target.kind, target.kind === "github" ? target.repository : target.channelId)
      return [{ ...entry, declaration, target, title, install, key, current: byPlace.get(key) }]
    })

    const claims = Map.groupBy(resolved, (entry) => entry.key)
    const claimed = new Set(resolved.flatMap((entry) => (entry.current ? [entry.current.id] : [])))
    const writable = resolved.filter((entry) => {
      const others = (claims.get(entry.key) ?? []).filter((other) => other !== entry)
      if (others.length > 0) {
        problems.push({
          path: path(entry.space.slug, entry.slug),
          message: `${others.map((other) => path(other.space.slug, other.slug)).join(" and ")} maps the same ${entry.title} place. Map each place once.`,
        })
        return false
      }
      if (entry.current && !context.shared.has(entry.current.spaceId)) {
        problems.push({
          path: path(entry.space.slug, entry.slug),
          message: `This ${entry.title} place is mapped to a space that the spec does not manage. Unmap it there first.`,
        })
        return false
      }
      return true
    })

    const writes = writable.flatMap((entry): Array<InfraPlan.Step> => {
      const declaration = entry.declaration
      const current = entry.current
      const target = path(entry.space.slug, entry.slug)
      const triggers = Object.entries(declaration.triggers ?? {}).map(([id, trigger]) =>
        trigger.prompt ? { id, prompt: trigger.prompt } : { id },
      )
      const fallback = declaration.fallback ?? current?.fallback
      const run = Effect.gen(function* () {
        const spaceId = yield* context.spaceId(entry.space.slug)
        const agentId = declaration.agent ? yield* context.agentId(declaration.agent) : undefined
        const place =
          current?.place ??
          (entry.target.kind === "github"
            ? yield* placeOf(context.actor, entry.install.id, entry.target.repository)
            : entry.target.channelId)
        yield* channelMappings.create(context.actor, {
          installId: entry.install.id,
          place,
          spaceId,
          ...(agentId && { agentId }),
          ...(typeof fallback === "boolean" && { fallback }),
          triggers,
        })
      })
      if (!current) {
        context.touch(entry.space.liveId)
        return [InfraPlan.step("create", "channel", target, run)]
      }
      const owner = context.slugOf(current.spaceId)
      const fields = InfraPlan.changed({
        space: owner !== entry.space.slug,
        agent: (current.agentId ? context.agentName(current.agentId) : undefined) !== declaration.agent,
        fallback: typeof declaration.fallback === "boolean" && declaration.fallback !== current.fallback,
        triggers: !sameTriggers(current.triggers, triggers),
      })
      if (fields.length === 0) return []
      context.touch(entry.space.liveId)
      context.touch(current.spaceId)
      return [
        InfraPlan.step("update", "channel", target, run, {
          fields,
          ...(fields.includes("space") && { from: path(owner ?? current.spaceId, entry.slug) }),
        }),
      ]
    })

    const removals = live.mappings
      .filter((mapping) => context.shared.has(mapping.spaceId) && !claimed.has(mapping.id))
      .map((mapping) => {
        context.touch(mapping.spaceId)
        return InfraPlan.step(
          "archive",
          "channel",
          path(context.slugOf(mapping.spaceId) ?? mapping.spaceId, pulled.get(mapping.id) ?? mapping.place),
          channelMappings.remove(context.actor, mapping.id, {}),
        )
      })

    return {
      steps: writes.toSorted(InfraPlan.byPath),
      removals: removals.toSorted(InfraPlan.byPath),
      problems,
      aliases: new Map(resolved.flatMap((entry) => (entry.current ? [[entry.current.id, entry.slug] as const] : []))),
    }
  }

  const pull = (
    live: Live,
    spaceId: Space.ID,
    name: (id: Agent.ID) => string | undefined,
    aliases: ReadonlyMap<ChannelMapping.ID, string>,
  ): Record<string, Channel.Declaration> => {
    return Object.fromEntries(
      named(live)
        .filter((entry) => entry.mapping.spaceId === spaceId)
        .map((entry): [string, Channel.Declaration] => {
          const mapping = entry.mapping
          const agent = mapping.agentId ? name(mapping.agentId) : undefined
          return [
            aliases.get(mapping.id) ?? entry.slug,
            {
              kind: mapping.provider,
              purpose: `${Channel.titles[mapping.provider]} ${mapping.placeName}`,
              ...(agent && { agent }),
              fallback: mapping.fallback,
              ...(mapping.triggers.length > 0 && {
                triggers: Object.fromEntries(
                  mapping.triggers.map((trigger) => [trigger.id, trigger.prompt ? { prompt: trigger.prompt } : {}]),
                ),
              }),
            },
          ]
        }),
    )
  }

  const pullBindings = (
    live: Live,
    spaceId: Space.ID,
    aliases: ReadonlyMap<ChannelMapping.ID, string>,
  ): Record<string, Channel.Target> => {
    return Object.fromEntries(
      named(live)
        .filter((entry) => entry.mapping.spaceId === spaceId)
        .map((entry): [string, Channel.Target] => [
          aliases.get(entry.mapping.id) ?? entry.slug,
          entry.mapping.provider === "github"
            ? { kind: "github", repository: entry.mapping.placeName }
            : { kind: "slack", channelId: entry.mapping.place },
        ]),
    )
  }

  return { diff, pull, pullBindings }
})
