export * as SessionRunner from "./runner.js"

import { Database } from "@ren/db/database"
import type { Agent } from "@ren/schema/agent"
import type { Auth } from "@ren/schema/auth"
import { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { and, eq, isNull } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Schema, Struct } from "effect"
import { AgentQueries } from "../agent/queries.js"
import { BrainHost } from "../brain-host.js"
import { OpenCodeStore } from "./opencode-store.js"

export class NotFound extends Schema.TaggedError<NotFound>()("SessionRunner.NotFound", { message: Schema.String }) {}

export class AlreadyExists extends Schema.TaggedError<AlreadyExists>()("SessionRunner.AlreadyExists", {
  message: Schema.String,
}) {}

export interface Owner {
  readonly organizationId: Auth.OrganizationID
  readonly spaceId: Space.ID
  readonly createdBy: Auth.UserID
}

export interface Info extends Owner {
  readonly id: Session.ID
  readonly rootId: Session.ID
  readonly parentId: Session.ID | null
  readonly harness: Session.Harness
  readonly title: string | null
  readonly status: "idle" | "busy"
  readonly outcome: string | null
  readonly createdAt: DateTime.Utc
  readonly updatedAt: DateTime.Utc | null
}

export interface Interface {
  readonly create: (
    owner: Owner,
    input: Session.StartInput,
    options?: { readonly agentId?: Agent.ID },
  ) => Effect.Effect<
    Session.Started,
    AlreadyExists | NotFound | BrainHost.BrainUnavailable | BrainHost.BrainRejectedError
  >
  readonly send: (
    input: Session.SendInput,
  ) => Effect.Effect<Session.Accepted, NotFound | BrainHost.BrainUnavailable | BrainHost.BrainRejectedError>
  readonly get: (sessionId: Session.ID) => Effect.Effect<Info, NotFound>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/SessionRunner") {}

const notFound = new NotFound({ message: "Session not found." })

const alreadyExists = new AlreadyExists({ message: "A session with this ID already exists." })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const brain = yield* BrainHost.Service

    return Service.of({
      create: Effect.fn("SessionRunner.create")(function* (
        owner: Owner,
        input: Session.StartInput,
        options: { readonly agentId?: Agent.ID } = {},
      ) {
        const startInput = yield* Schema.encodeEffect(Session.StartInput)(Struct.omit(input, ["initialMessage"])).pipe(
          Effect.orDie,
        )
        const created = yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            if (
              options.agentId &&
              (yield* transaction
                .select({ id: Database.Schema.agent.id })
                .from(Database.Schema.agent)
                .where(
                  and(
                    eq(Database.Schema.agent.id, options.agentId),
                    eq(Database.Schema.agent.organization_id, owner.organizationId),
                    eq(Database.Schema.agent.is_subagent, false),
                    isNull(Database.Schema.agent.archived_at),
                    AgentQueries.isInSpace(owner.spaceId),
                  ),
                )
                .for("share")).length === 0
            )
              return yield* new NotFound({ message: "Agent not found." })
            return yield* transaction
              .insert(Database.Schema.agent_session)
              .values({
                id: input.sessionId,
                organization_id: owner.organizationId,
                space_id: owner.spaceId,
                created_by: owner.createdBy,
                root_id: input.sessionId,
                harness: input.harness,
                agent_id: options.agentId,
                start_input: startInput,
              })
              .onConflictDoNothing()
              .returning({ id: Database.Schema.agent_session.id })
          }),
        )
        if (created.length === 0) return yield* alreadyExists
        return yield* brain.start(input, owner)
      }),
      send: Effect.fn("SessionRunner.send")(function* (input: Session.SendInput) {
        const row = (yield* database.transaction((transaction) =>
          transaction
            .select({
              organizationId: Database.Schema.agent_session.organization_id,
              spaceId: Database.Schema.agent_session.space_id,
              startInput: Database.Schema.agent_session.start_input,
            })
            .from(Database.Schema.agent_session)
            .where(eq(Database.Schema.agent_session.id, input.sessionId)),
        )).at(0)
        if (!row) return yield* notFound
        return yield* brain.send(input, row.organizationId).pipe(
          Effect.catchTag("SessionNotStartedError", (error) =>
            Effect.gen(function* () {
              if (!row.startInput)
                return yield* Effect.die(
                  new Error(`Session ${input.sessionId} is not started on its host and has no start input`, {
                    cause: error,
                  }),
                )
              const start = yield* Schema.decodeEffect(Session.StartInput)(row.startInput).pipe(Effect.orDie)
              yield* brain.start(start, row)
              return yield* brain
                .send(input, row.organizationId)
                .pipe(
                  Effect.catchTag("SessionNotStartedError", (cause) =>
                    Effect.die(
                      new Error(`Session ${input.sessionId} is not started on its host after a start`, { cause }),
                    ),
                  ),
                )
            }),
          ),
        )
      }),
      get: Effect.fn("SessionRunner.get")(function* (sessionId: Session.ID) {
        const row = (yield* database.transaction((transaction) =>
          transaction
            .select({ session: Database.Schema.agent_session, opencode: OpenCodeStore.summary })
            .from(Database.Schema.agent_session)
            .leftJoin(Database.Schema.opencode_session, OpenCodeStore.join)
            .where(eq(Database.Schema.agent_session.id, sessionId)),
        )).at(0)
        if (!row) return yield* notFound
        return {
          id: row.session.id,
          organizationId: row.session.organization_id,
          spaceId: row.session.space_id,
          createdBy: row.session.created_by,
          rootId: row.session.root_id,
          harness: row.session.harness,
          parentId: row.session.parent_id,
          title: row.opencode?.title ?? null,
          status: row.opencode?.timeSuspended ? "busy" : "idle",
          outcome: row.opencode?.outcome ?? null,
          createdAt: DateTime.fromDateUnsafe(row.session.created_at),
          updatedAt: row.opencode ? DateTime.makeUnsafe(row.opencode.updatedAt) : null,
        } satisfies Info
      }),
    })
  }),
)
