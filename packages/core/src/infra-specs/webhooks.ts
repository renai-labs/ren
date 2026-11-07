export * as InfraWebhooks from "./webhooks.js"

import { Database } from "@ren/db/database"
import type { Agent } from "@ren/schema/agent"
import type { Auth } from "@ren/schema/auth"
import type { Space } from "@ren/schema/space"
import { Webhook } from "@ren/schema/webhook"
import { and, asc, eq, isNull } from "drizzle-orm"
import { Effect, Schema, Struct } from "effect"
import { Primitive } from "../primitive.js"
import { WebhookSource } from "../webhook/source.js"
import { Webhooks } from "../webhooks.js"
import { InfraPlan } from "./plan.js"

type Source =
  | { readonly _tag: "custom"; readonly name: string; readonly message: string; readonly parser: Webhook.Parser }
  | { readonly _tag: "preset"; readonly app: string; readonly preset: string }

export interface LiveWebhook {
  readonly id: Webhook.ID
  readonly spaceId: Space.ID
  readonly slug: string
  readonly agentId: Agent.ID | null
  readonly source: Source
}

export interface Live {
  readonly webhooks: ReadonlyArray<LiveWebhook>
}

export const path = (space: string, slug: string) => `spaces/${space}/webhooks/${slug}`

const key = (spaceId: string, slug: string) => `${spaceId}/${slug}`

const parserFields = ["signature", "handshake", "signedHandshake", "filter", "eventId", "threadKey", "title"] as const

const parserOf = (declaration: Webhook.CustomDeclaration): Webhook.Parser => Struct.pick(declaration, parserFields)

const encodeParser = Schema.encodeSync(Webhook.Parser)

const sameParser = Schema.toEquivalence(Webhook.Parser)

const isPreset = (declaration: Webhook.Declaration): declaration is Webhook.PresetDeclaration => "app" in declaration

export const canonical = (slug: string, declaration: Webhook.Declaration) =>
  isPreset(declaration)
    ? { app: declaration.app, preset: declaration.preset, ...(declaration.agent && { agent: declaration.agent }) }
    : {
        name: declaration.name ?? slug,
        ...(declaration.agent && { agent: declaration.agent }),
        message: declaration.message,
        parser: encodeParser(parserOf(declaration)),
      }

export const load = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  organizationId: Auth.OrganizationID,
) {
  const rows = yield* transaction
    .select({
      webhook: Database.Schema.webhook,
      agentOrganizationId: Database.Schema.agent.organization_id,
      appSlug: Database.Schema.app.slug,
    })
    .from(Database.Schema.webhook)
    .leftJoin(Database.Schema.agent, eq(Database.Schema.agent.id, Database.Schema.webhook.agent_id))
    .leftJoin(Database.Schema.app, eq(Database.Schema.app.id, Database.Schema.webhook.app_id))
    .where(
      and(eq(Database.Schema.webhook.organization_id, organizationId), isNull(Database.Schema.webhook.archived_at)),
    )
    .orderBy(asc(Database.Schema.webhook.space_id), asc(Database.Schema.webhook.slug))
  const webhooks = yield* Effect.forEach(rows, (row) =>
    Effect.map(WebhookSource.of(row.webhook), (source): LiveWebhook => ({
      id: row.webhook.id,
      spaceId: row.webhook.space_id,
      slug: row.webhook.slug,
      agentId: row.agentOrganizationId ? row.webhook.agent_id : null,
      source: source._tag === "preset" ? { _tag: "preset", app: row.appSlug ?? "", preset: source.preset } : source,
    })),
  )
  return { webhooks } satisfies Live
})

export const make = Effect.gen(function* () {
  const webhooks = yield* Webhooks.Service
  const database = yield* Database.Service

  const appIdOf = (slug: string) =>
    database.db
      .select({ id: Database.Schema.app.id })
      .from(Database.Schema.app)
      .where(and(eq(Database.Schema.app.slug, slug), isNull(Database.Schema.app.archived_at)))
      .pipe(
        Effect.orDie,
        Effect.flatMap((rows) => {
          const found = rows.at(0)
          return found
            ? Effect.succeed(found.id)
            : Effect.fail(new Primitive.NotFound({ message: `App “${slug}” not found.` }))
        }),
      )

  const created = (context: InfraPlan.Context, space: string, slug: string, declaration: Webhook.Declaration) =>
    Effect.gen(function* () {
      const spaceId = yield* context.spaceId(space)
      const agentId = declaration.agent ? yield* context.agentId(declaration.agent) : undefined
      yield* webhooks.create(context.actor, {
        spaceId,
        slug,
        source: isPreset(declaration)
          ? { _tag: "preset", appId: yield* appIdOf(declaration.app), preset: declaration.preset }
          : {
              _tag: "custom",
              name: declaration.name ?? slug,
              message: declaration.message,
              parser: parserOf(declaration),
            },
        ...(agentId && { agentId }),
      })
    })

  const fieldsOf = (
    context: InfraPlan.Context,
    current: LiveWebhook,
    slug: string,
    declaration: Webhook.Declaration,
  ) => {
    const agent = current.agentId ? (context.agentName(current.agentId) ?? current.agentId) : undefined
    if (current.source._tag === "preset" || isPreset(declaration))
      return InfraPlan.changed({ agent: agent !== declaration.agent })
    return InfraPlan.changed({
      name: current.source.name !== (declaration.name ?? slug),
      agent: agent !== declaration.agent,
      message: current.source.message !== declaration.message,
      parser: !sameParser(current.source.parser, parserOf(declaration)),
    })
  }

  const isSameSource = (current: LiveWebhook, declaration: Webhook.Declaration) =>
    current.source._tag === "preset"
      ? isPreset(declaration) && current.source.app === declaration.app && current.source.preset === declaration.preset
      : !isPreset(declaration)

  const diff = (context: InfraPlan.Context, live: Live): InfraPlan.Planned => {
    const inScope = live.webhooks.filter((webhook) => context.shared.has(webhook.spaceId))
    const byKey = new Map(inScope.map((webhook) => [key(webhook.spaceId, webhook.slug), webhook]))
    const subagents = new Set(
      context.spaces.flatMap((space) =>
        Object.keys(space.declaration.agents).filter((name) => space.declaration.agents[name]?.isSubagent),
      ),
    )
    const declared = context.spaces.flatMap((space) =>
      Object.entries(space.declaration.webhooks).map(([slug, webhook]) => ({
        space: space.slug,
        liveId: space.liveId,
        slug,
        webhook,
        current: byKey.get(key(space.liveId ?? "", slug)),
      })),
    )
    const problems = declared.flatMap((entry) => [
      ...(entry.webhook.agent && subagents.has(entry.webhook.agent)
        ? [
            {
              path: path(entry.space, entry.slug),
              message: `Agent “${entry.webhook.agent}” is a subagent, so it cannot run a webhook. Pick another agent.`,
            },
          ]
        : []),
      ...(entry.current && !isSameSource(entry.current, entry.webhook)
        ? [
            {
              path: path(entry.space, entry.slug),
              message:
                "A webhook cannot change between custom and preset, or to another preset. Give the new one another slug.",
            },
          ]
        : []),
    ])

    const writes = declared.flatMap((entry): Array<InfraPlan.Step> => {
      const target = path(entry.space, entry.slug)
      const current = entry.current
      if (!current) {
        context.touch(entry.liveId)
        return [InfraPlan.step("create", "webhook", target, created(context, entry.space, entry.slug, entry.webhook))]
      }
      if (!isSameSource(current, entry.webhook)) return []
      const fields = fieldsOf(context, current, entry.slug, entry.webhook)
      if (fields.length === 0) return []
      const declaration = entry.webhook
      context.touch(current.spaceId)
      return [
        InfraPlan.step(
          "update",
          "webhook",
          target,
          Effect.gen(function* () {
            yield* webhooks.update(context.actor, current.id, {
              ...(fields.includes("agent") && {
                agentId: declaration.agent ? yield* context.agentId(declaration.agent) : null,
              }),
              ...(!isPreset(declaration) && {
                ...(fields.includes("name") && { name: declaration.name ?? entry.slug }),
                ...(fields.includes("message") && { message: declaration.message }),
                ...(fields.includes("parser") && { parser: parserOf(declaration) }),
              }),
            })
          }),
          { fields },
        ),
      ]
    })

    const wanted = new Set(declared.flatMap((entry) => (entry.liveId ? [key(entry.liveId, entry.slug)] : [])))
    const archives = inScope
      .filter((webhook) => !wanted.has(key(webhook.spaceId, webhook.slug)))
      .map((webhook) => {
        context.touch(webhook.spaceId)
        return InfraPlan.step(
          "archive",
          "webhook",
          path(context.slugOf(webhook.spaceId) ?? webhook.spaceId, webhook.slug),
          webhooks.archive(context.actor, webhook.id),
        )
      })

    return { steps: writes.toSorted(InfraPlan.byPath), removals: archives.toSorted(InfraPlan.byPath), problems }
  }

  const pull = (
    live: Live,
    spaceId: Space.ID,
    name: (id: Agent.ID) => string | undefined,
  ): Record<string, Webhook.Declaration> =>
    Object.fromEntries(
      live.webhooks
        .filter((webhook) => webhook.spaceId === spaceId)
        .map((webhook) => {
          const agent = webhook.agentId ? name(webhook.agentId) : undefined
          const source = webhook.source
          return [
            webhook.slug,
            source._tag === "preset"
              ? { app: source.app, preset: source.preset, ...(agent && { agent }) }
              : {
                  ...(source.name !== webhook.slug && { name: source.name }),
                  ...(agent && { agent }),
                  message: source.message,
                  ...Struct.pick(source.parser, parserFields),
                },
          ]
        }),
    )

  return { diff, pull }
})
