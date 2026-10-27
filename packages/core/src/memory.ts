export * as Memory from "./memory.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import { Memory } from "@ren/schema/memory"
import type { Space } from "@ren/schema/space"
import { and, eq, isNull, or, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Access } from "./access.js"
import type { Actor } from "./actor.js"
import { MemoryPolicy } from "./memory/policy.js"
import { Primitive } from "./primitive.js"
import { SpaceQueries } from "./space/queries.js"

export interface Interface {
  readonly list: (
    actor: Actor.Info,
    input: Memory.ListInput,
  ) => Effect.Effect<ReadonlyArray<string>, Primitive.NotFound>
  readonly read: (actor: Actor.Info, input: Memory.PathInput) => Effect.Effect<Memory.File, Primitive.NotFound>
  readonly write: (
    actor: Actor.Info,
    input: Memory.WriteInput,
  ) => Effect.Effect<void, Primitive.NotFound | Primitive.Forbidden>
  readonly edit: (
    actor: Actor.Info,
    input: Memory.EditInput,
  ) => Effect.Effect<Memory.File, Primitive.NotFound | Primitive.Forbidden | Primitive.Invalid>
  readonly delete: (
    actor: Actor.Info,
    input: Memory.PathInput,
  ) => Effect.Effect<void, Primitive.NotFound | Primitive.Forbidden>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Memory") {}

const missing = (path: string) => new Primitive.NotFound({ message: `The memory has no file ${path}.` })

// oxlint-disable-next-line ren/no-comments -- memory M8: the root files that a brain’s chats get, from the organization’s memory and its space’s.
export const roots = Effect.fnUntraced(function* (
  db: Database.Interface["db"],
  owner: { readonly organizationId: Auth.OrganizationID; readonly spaceId: Space.ID },
) {
  const rows = yield* db
    .select({
      organizationId: Database.Schema.memory.organization_id,
      spaceId: Database.Schema.memory.space_id,
      content: sql<string | null>`${Database.Schema.memory.files} ->> ${Memory.root}`,
    })
    .from(Database.Schema.memory)
    .where(
      or(
        eq(Database.Schema.memory.organization_id, owner.organizationId),
        eq(Database.Schema.memory.space_id, owner.spaceId),
      ),
    )
  const root = (ownerId: string) => {
    const content = rows.find((row) => (row.spaceId ?? row.organizationId) === ownerId)?.content
    return content
      ? { content: content.slice(0, Memory.injectedLength), truncated: content.length > Memory.injectedLength }
      : null
  }
  return { spaceId: owner.spaceId, organization: root(owner.organizationId), space: root(owner.spaceId) }
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service

    const find = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      spaceId: Space.ID | undefined,
    ) {
      const resource = spaceId
        ? yield* Effect.gen(function* () {
            const space = (yield* transaction
              .select({ membershipId: SpaceQueries.membership.id })
              .from(Database.Schema.space)
              .leftJoin(SpaceQueries.membership, SpaceQueries.membershipOf(actor))
              .where(
                and(
                  eq(Database.Schema.space.id, spaceId),
                  eq(Database.Schema.space.organization_id, actor.organizationId),
                  isNull(Database.Schema.space.archived_at),
                ),
              )).at(0)
            if (!space) return yield* new Primitive.NotFound({ message: "Space not found." })
            return MemoryPolicy.space({
              isMember: Boolean(space.membershipId),
              isElsewhere: Boolean(actor.agent && actor.agent.spaceId !== spaceId),
            })
          })
        : MemoryPolicy.organization({ isAgent: Boolean(actor.agent) })
      if (!access.isAllowed({ actor, action: MemoryPolicy.actions.read, resource }))
        return yield* new Primitive.NotFound({ message: spaceId ? "Space not found." : "Memory not found." })
      const row = (yield* transaction
        .select({ files: Database.Schema.memory.files })
        .from(Database.Schema.memory)
        .where(
          spaceId
            ? eq(Database.Schema.memory.space_id, spaceId)
            : eq(Database.Schema.memory.organization_id, actor.organizationId),
        )).at(0)
      return {
        files: row?.files ?? {},
        canWrite: access.isAllowed({ actor, action: MemoryPolicy.actions.write, resource }),
      }
    })

    const read = (actor: Actor.Info, spaceId: Space.ID | undefined) =>
      database.transaction((transaction) => find(transaction, actor, spaceId))

    // oxlint-disable-next-line ren/no-comments -- memory M3: each write locks its memory’s row, so two writes to different files of one memory both land.
    const change = <E>(
      actor: Actor.Info,
      spaceId: Space.ID | undefined,
      apply: (files: Memory.Files) => Effect.Effect<Memory.Files, E>,
    ) =>
      database.transaction((transaction) =>
        Effect.gen(function* () {
          const found = yield* find(transaction, actor, spaceId)
          if (!found.canWrite)
            return yield* new Primitive.Forbidden({
              message: spaceId
                ? "An agent edits only the memory of the space its chat is in."
                : "Only organization admins edit the organization’s memory. Agents only read it.",
            })
          const owner = spaceId
            ? eq(Database.Schema.memory.space_id, spaceId)
            : eq(Database.Schema.memory.organization_id, actor.organizationId)
          yield* transaction
            .insert(Database.Schema.memory)
            .values(spaceId ? { space_id: spaceId } : { organization_id: actor.organizationId })
            .onConflictDoNothing({
              target: spaceId ? Database.Schema.memory.space_id : Database.Schema.memory.organization_id,
            })
          const locked = (yield* transaction
            .select({ files: Database.Schema.memory.files })
            .from(Database.Schema.memory)
            .where(owner)
            .for("update")).at(0)
          const files = yield* apply(locked?.files ?? {})
          yield* transaction
            .update(Database.Schema.memory)
            .set({ files, updated_at: sql`now()` })
            .where(owner)
          return files
        }),
      )

    return Service.of({
      list: Effect.fn("Memory.list")(function* (actor: Actor.Info, input: Memory.ListInput) {
        return Object.keys((yield* read(actor, input.spaceId)).files)
          .filter((path) => path.startsWith(input.prefix ?? ""))
          .toSorted()
      }),
      read: Effect.fn("Memory.read")(function* (actor: Actor.Info, input: Memory.PathInput) {
        const files = (yield* read(actor, input.spaceId)).files
        if (!Object.hasOwn(files, input.path)) return yield* missing(input.path)
        return { path: input.path, content: files[input.path] ?? "" }
      }),
      write: Effect.fn("Memory.write")(function* (actor: Actor.Info, input: Memory.WriteInput) {
        yield* change(actor, input.spaceId, (files) => Effect.succeed({ ...files, [input.path]: input.content }))
      }),
      edit: Effect.fn("Memory.edit")(function* (actor: Actor.Info, input: Memory.EditInput) {
        const files = yield* change(actor, input.spaceId, (files) =>
          Effect.gen(function* () {
            if (!Object.hasOwn(files, input.path)) return yield* missing(input.path)
            const current = files[input.path] ?? ""
            const count = current.split(input.oldString).length - 1
            if (count === 0)
              return yield* new Primitive.Invalid({ message: "oldString is not in the file.", field: "oldString" })
            if (count > 1 && !input.replaceAll)
              return yield* new Primitive.Invalid({
                message: `oldString occurs ${count} times. Add context to make it unique, or set replaceAll.`,
                field: "oldString",
              })
            const next = input.replaceAll
              ? current.replaceAll(input.oldString, () => input.newString)
              : current.replace(input.oldString, () => input.newString)
            return { ...files, [input.path]: next }
          }),
        )
        return { path: input.path, content: files[input.path] ?? "" }
      }),
      delete: Effect.fn("Memory.delete")(function* (actor: Actor.Info, input: Memory.PathInput) {
        yield* change(actor, input.spaceId, (files) =>
          Object.hasOwn(files, input.path)
            ? Effect.succeed(Object.fromEntries(Object.entries(files).filter(([path]) => path !== input.path)))
            : Effect.fail(missing(input.path)),
        )
      }),
    })
  }),
)
