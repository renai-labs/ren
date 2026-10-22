export * as Actor from "./actor.js"

import { Database } from "@ren/db/database"
import type { CurrentHost } from "@ren/host-api/ren-host-api"
import type { Agent } from "@ren/schema/agent"
import { Auth } from "@ren/schema/auth"
import type { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { and, eq, isNull } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Primitive } from "./primitive.js"

export interface Info {
  readonly userId: Auth.UserID
  readonly organizationId: Auth.OrganizationID
  readonly roles: ReadonlyArray<string>
  readonly agent?: {
    readonly agentId: Agent.ID
    readonly sessionId: Session.ID
    readonly spaceId: Space.ID
  }
}

export interface AgentInfo extends Info {
  readonly agent: NonNullable<Info["agent"]>
}

export interface Interface {
  readonly fromHost: (host: CurrentHost["Service"]) => Effect.Effect<AgentInfo, Primitive.Forbidden>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Actor") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    return Service.of({
      fromHost: Effect.fn("Actor.fromHost")(function* (host: CurrentHost["Service"]) {
        const row = (yield* database.db
          .select({ session: Database.Schema.agent_session, role: Database.Schema.member.role })
          .from(Database.Schema.agent_session)
          .innerJoin(
            Database.Schema.member,
            and(
              eq(Database.Schema.member.organizationId, Database.Schema.agent_session.organization_id),
              eq(Database.Schema.member.userId, Database.Schema.agent_session.created_by),
            ),
          )
          .innerJoin(Database.Schema.space, eq(Database.Schema.space.id, Database.Schema.agent_session.space_id))
          .where(
            and(
              eq(Database.Schema.agent_session.id, host.sessionId),
              eq(Database.Schema.agent_session.organization_id, host.organizationId),
              isNull(Database.Schema.agent_session.archived_at),
              isNull(Database.Schema.space.archived_at),
            ),
          )
          .pipe(Effect.orDie)).at(0)
        if (!row) return yield* new Primitive.Forbidden({ message: "The host session is not available." })
        const agentId =
          row.session.agent_id ??
          (yield* database.db
            .select({ id: Database.Schema.agent.id })
            .from(Database.Schema.agent)
            .where(
              and(
                isNull(Database.Schema.agent.organization_id),
                eq(Database.Schema.agent.name, "ren"),
                isNull(Database.Schema.agent.archived_at),
              ),
            )
            .pipe(Effect.orDie)).at(0)?.id
        if (!agentId) return yield* new Primitive.Forbidden({ message: "The session’s agent is not available." })
        return {
          userId: row.session.created_by,
          organizationId: host.organizationId,
          roles: row.role.split(","),
          agent: { agentId, sessionId: host.sessionId, spaceId: row.session.space_id },
        }
      }),
    })
  }),
)
