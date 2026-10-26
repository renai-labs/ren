export * as CredentialRequirements from "./credential-requirements.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import type { AppProfile } from "@ren/schema/app-profile"
import { Brain } from "@ren/schema/brain"
import type { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { and, eq, isNull } from "drizzle-orm"
import { Context, Effect, Layer, Option } from "effect"
import type { Actor } from "./actor.js"
import { AppProfiles } from "./app/profiles.js"
import { Credentials } from "./credentials.js"
import { Primitive } from "./primitive.js"

export interface Interface {
  readonly forSession: (actor: Actor.Info, sessionId: Session.ID) => Effect.Effect<AppProfile.Reach, Primitive.NotFound>
  readonly forSpace: (actor: Actor.Info, spaceId: Space.ID) => Effect.Effect<AppProfile.Reach, Primitive.NotFound>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/CredentialRequirements") {}

const members = Database.Schema.space_member
const chats = Database.Schema.agent_session

// oxlint-disable-next-line ren/no-comments -- profiles.md P15: the composer pill. A chat reaches what its brain's scope reaches (§7 rule 6); a new chat reaches what its space reaches. Each profile comes with its gaps; one the caller may not see is left out.
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const profiles = yield* AppProfiles.Service

    const member = Effect.fnUntraced(function* (actor: Actor.Info, spaceId: Space.ID) {
      const found = (yield* database.db
        .select({ id: members.id })
        .from(members)
        .innerJoin(Database.Schema.space, eq(Database.Schema.space.id, members.space_id))
        .where(
          and(
            eq(members.space_id, spaceId),
            eq(members.user_id, actor.userId),
            eq(Database.Schema.space.organization_id, actor.organizationId),
            isNull(members.archived_at),
            isNull(Database.Schema.space.archived_at),
          ),
        )
        .pipe(Effect.orDie)).at(0)
      if (!found) return yield* new Primitive.NotFound({ message: "Space not found." })
    })

    const space = Effect.fnUntraced(function* (actor: Actor.Info, spaceId: Space.ID) {
      const found = (yield* database.db
        .select({ id: Database.Schema.space.id })
        .from(Database.Schema.space)
        .where(
          and(
            eq(Database.Schema.space.id, spaceId),
            eq(Database.Schema.space.organization_id, actor.organizationId),
            isNull(Database.Schema.space.archived_at),
          ),
        )
        .pipe(Effect.orDie)).at(0)
      if (!found) return yield* new Primitive.NotFound({ message: "Space not found." })
    })

    const reach = Effect.fnUntraced(function* (actor: Actor.Info, scope: AppProfiles.Reach) {
      const reached = yield* profiles.reachable(scope)
      return {
        profiles: yield* profiles.infos(
          actor,
          reached.map((profile) => profile.id),
        ),
      } satisfies AppProfile.Reach
    })

    return Service.of({
      // oxlint-disable-next-line ren/no-comments -- profiles.md §10: admins see a space's profiles without joining it; `infos` still gives them metadata only for private ones.
      forSpace: Effect.fn("CredentialRequirements.forSpace")(function* (actor, spaceId) {
        if (actor.roles.some(Auth.isAdministrator)) yield* space(actor, spaceId)
        else yield* member(actor, spaceId)
        return yield* reach(actor, { organizationId: actor.organizationId, spaceId: Option.some(spaceId) })
      }),
      forSession: Effect.fn("CredentialRequirements.forSession")(function* (actor, sessionId) {
        const chat = (yield* database.db
          .select({ spaceId: chats.space_id, brainId: chats.brain_id, generation: Database.Schema.brain.generation })
          .from(chats)
          .leftJoin(Database.Schema.brain, eq(Database.Schema.brain.id, chats.brain_id))
          .where(and(eq(chats.id, sessionId), eq(chats.organization_id, actor.organizationId)))
          .pipe(Effect.orDie)).at(0)
        if (!chat) return yield* new Primitive.NotFound({ message: "Session not found." })
        yield* member(actor, chat.spaceId)
        if (!chat.brainId || !chat.generation)
          return yield* reach(actor, { organizationId: actor.organizationId, spaceId: Option.some(chat.spaceId) })
        const scope = yield* Credentials.scopeOf(database.db, {
          kind: "brain",
          id: Brain.ID.make(chat.brainId),
          generation: chat.generation,
        }).pipe(Effect.orDie)
        return yield* reach(
          actor,
          Option.getOrElse(scope, () => ({ organizationId: actor.organizationId, spaceId: Option.none<Space.ID>() })),
        )
      }),
    })
  }),
)
