export * as InfraWebhooks from "./webhooks.js"

import { Database } from "@ren/db/database"
import type { Agent } from "@ren/schema/agent"
import type { Auth } from "@ren/schema/auth"
import type { Space } from "@ren/schema/space"
import { Webhook } from "@ren/schema/webhook"
import { and, asc, eq, isNull } from "drizzle-orm"
import { Effect, Schema, Struct } from "effect"
import { Webhooks } from "../webhooks.js"
import { InfraPlan } from "./plan.js"

export interface LiveWebhook {
  readonly id: Webhook.ID
  readonly spaceId: Space.ID
  readonly slug: string
  readonly name: string
  readonly agentId: Agent.ID | null
  readonly message: string
  readonly parser: Webhook.Parser
}

export interface Live {
  readonly webhooks: ReadonlyArray<LiveWebhook>
}

export const path = (space: string, slug: string) => `spaces/${space}/webhooks/${slug}`

const key = (spaceId: Space.ID, slug: string) => `${spaceId}/${slug}`

const parserFields = ["signature", "handshake", "signedHandshake", "filter", "eventId", "threadKey", "title"] as const

const parserOf = (declaration: Webhook.Declaration): Webhook.Parser => Struct.pick(declaration, parserFields)

const encodeParser = Schema.encodeSync(Webhook.Parser)

const decodeParser = Schema.decodeUnknownSync(Webhook.Parser)

const sameParser = Schema.toEquivalence(Webhook.Parser)

export const canonical = (slug: string, declaration: Webhook.Declaration) => ({
  name: declaration.name ?? slug,
  ...(declaration.agent && { agent: declaration.agent }),
  message: declaration.message,
  parser: encodeParser(parserOf(declaration)),
})

export const load = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  organizationId: Auth.OrganizationID,
) {
  const rows = yield* transaction
    .select({ webhook: Database.Schema.webhook, agentOrganizationId: Database.Schema.agent.organization_id })
    .from(Database.Schema.webhook)
    .leftJoin(Database.Schema.agent, eq(Database.Schema.agent.id, Database.Schema.webhook.agent_id))
    .where(
      and(eq(Database.Schema.webhook.organization_id, organizationId), isNull(Database.Schema.webhook.archived_at)),
    )
    .orderBy(asc(Database.Schema.webhook.space_id), asc(Database.Schema.webhook.slug))
  return {
    webhooks: rows.map((row) => ({
      id: row.webhook.id,
      spaceId: row.webhook.space_id,
      slug: row.webhook.slug,
      name: row.webhook.name,
      agentId: row.agentOrganizationId ? row.webhook.agent_id : null,
      message: row.webhook.message,
      parser: decodeParser(row.webhook.parser),
    })),
  } satisfies Live
})

// oxlint-disable-next-line ren/no-comments -- W24: apply creates a webhook as listening and never changes its mode, its token or its signing secret, which are live state.
export const make = Effect.gen(function* () {
  const webhooks = yield* Webhooks.Service

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
      })),
    )
    const problems = declared.flatMap((entry) =>
      entry.webhook.agent && subagents.has(entry.webhook.agent)
        ? [
            {
              path: path(entry.space, entry.slug),
              message: `Agent “${entry.webhook.agent}” is a subagent, so it cannot run a webhook. Pick another agent.`,
            },
          ]
        : [],
    )

    const writes = declared.flatMap((entry): Array<InfraPlan.Step> => {
      const target = path(entry.space, entry.slug)
      const declaration = entry.webhook
      const wanted = canonical(entry.slug, declaration)
      const current = entry.liveId ? byKey.get(key(entry.liveId, entry.slug)) : undefined
      if (!current) {
        context.touch(entry.liveId)
        return [
          InfraPlan.step(
            "create",
            "webhook",
            target,
            Effect.gen(function* () {
              yield* webhooks.create(context.actor, {
                spaceId: yield* context.spaceId(entry.space),
                name: wanted.name,
                slug: entry.slug,
                message: declaration.message,
                parser: parserOf(declaration),
                ...(declaration.agent && { agentId: yield* context.agentId(declaration.agent) }),
              })
            }),
          ),
        ]
      }
      const agent = current.agentId ? (context.agentName(current.agentId) ?? current.agentId) : undefined
      const fields = InfraPlan.changed({
        name: current.name !== wanted.name,
        agent: agent !== wanted.agent,
        message: current.message !== wanted.message,
        parser: !sameParser(current.parser, parserOf(declaration)),
      })
      if (fields.length === 0) return []
      context.touch(current.spaceId)
      return [
        InfraPlan.step(
          "update",
          "webhook",
          target,
          Effect.gen(function* () {
            yield* webhooks.update(context.actor, current.id, {
              ...(fields.includes("name") && { name: wanted.name }),
              ...(fields.includes("agent") && {
                agentId: declaration.agent ? yield* context.agentId(declaration.agent) : null,
              }),
              ...(fields.includes("message") && { message: declaration.message }),
              ...(fields.includes("parser") && { parser: parserOf(declaration) }),
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
          return [
            webhook.slug,
            {
              ...(webhook.name !== webhook.slug && { name: webhook.name }),
              ...(agent && { agent }),
              message: webhook.message,
              ...Struct.pick(webhook.parser, parserFields),
            },
          ]
        }),
    )

  return { diff, pull }
})
