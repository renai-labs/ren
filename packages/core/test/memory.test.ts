import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Agent } from "@ren/schema/agent"
import { Session } from "@ren/schema/session"
import { Space } from "@ren/schema/space"
import { Effect, Layer } from "effect"
import { Access } from "../src/access.js"
import type { Actor } from "../src/actor.js"
import { Memory } from "../src/memory.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(Memory.layer.pipe(Layer.provideMerge(Access.layer), Layer.provideMerge(Testing.layer)))

const asAgent = (actor: Actor.Info, spaceId: Space.ID): Actor.Info => ({
  ...actor,
  agent: { agentId: Agent.ID.create(), sessionId: Session.ID.create(), spaceId, fence: null },
})

describe("Memory", () => {
  it.live(
    "a space member writes, edits, lists and deletes files; the space’s root goes to its brains (memory M8)",
    () =>
      Effect.gen(function* () {
        const memory = yield* Memory.Service
        const owner = yield* Seed.owner()
        const ada = { userId: owner.createdBy, organizationId: owner.organizationId, roles: ["owner"] }
        const spaceId = owner.spaceId
        yield* memory.write(ada, { spaceId, path: "memory.md", content: "- Prefers short replies.\n" })
        yield* memory.write(ada, { spaceId, path: "people/ana.md", content: "Ana leads design." })
        expect(
          yield* memory.edit(ada, { spaceId, path: "memory.md", oldString: "short", newString: "$& long" }),
        ).toEqual({ path: "memory.md", content: "- Prefers $& long replies.\n" })
        expect(yield* memory.list(ada, { spaceId, prefix: "people/" })).toEqual(["people/ana.md"])
        yield* memory.delete(ada, { spaceId, path: "people/ana.md" })
        expect(yield* memory.list(ada, { spaceId })).toEqual(["memory.md"])
        expect((yield* Effect.flip(memory.read(ada, { spaceId, path: "people/ana.md" })))._tag).toBe(
          "Primitive.NotFound",
        )
        const database = yield* Database.Service
        expect(yield* Memory.roots(database.db, { organizationId: owner.organizationId, spaceId })).toEqual({
          spaceId,
          organization: null,
          space: { content: "- Prefers $& long replies.\n", truncated: false },
        })
      }),
  )

  it.live("an edit whose text is missing or occurs twice changes nothing", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service
      const owner = yield* Seed.owner()
      const ada = { userId: owner.createdBy, organizationId: owner.organizationId, roles: ["owner"] }
      const spaceId = owner.spaceId
      yield* memory.write(ada, { spaceId, path: "memory.md", content: "- a\n- a\n" })
      const missing = yield* Effect.flip(
        memory.edit(ada, { spaceId, path: "memory.md", oldString: "b", newString: "c" }),
      )
      const twice = yield* Effect.flip(memory.edit(ada, { spaceId, path: "memory.md", oldString: "a", newString: "c" }))
      expect([missing._tag, twice._tag]).toEqual(["Primitive.Invalid", "Primitive.Invalid"])
      expect(
        yield* memory.edit(ada, { spaceId, path: "memory.md", oldString: "a", newString: "c", replaceAll: true }),
      ).toEqual({ path: "memory.md", content: "- c\n- c\n" })
    }),
  )

  it.live("a path is never both a file and a folder, so the memory fits in a folder on disk", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service
      const owner = yield* Seed.owner()
      const ada = { userId: owner.createdBy, organizationId: owner.organizationId, roles: ["owner"] }
      const spaceId = owner.spaceId
      yield* memory.write(ada, { spaceId, path: "people/ana.md", content: "Ana." })
      const file = yield* Effect.flip(memory.write(ada, { spaceId, path: "people", content: "All." }))
      const folder = yield* Effect.flip(memory.write(ada, { spaceId, path: "people/ana.md/notes.md", content: "Hi." }))
      expect([file._tag, folder._tag]).toEqual(["Primitive.Invalid", "Primitive.Invalid"])
      yield* memory.write(ada, { spaceId, path: "people.md", content: "All." })
      expect(yield* memory.list(ada, { spaceId })).toEqual(["people.md", "people/ana.md"])
    }),
  )

  it.live("writes to two files of one memory at the same time both land (memory M3)", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service
      const owner = yield* Seed.owner()
      const ada = { userId: owner.createdBy, organizationId: owner.organizationId, roles: ["owner"] }
      const spaceId = owner.spaceId
      yield* Effect.forEach(
        Array.from({ length: 8 }, (_, index) => `notes/${index}.md`),
        (path) => memory.write(ada, { spaceId, path, content: path }),
        { concurrency: "unbounded", discard: true },
      )
      expect(yield* memory.list(ada, { spaceId })).toHaveLength(8)
    }),
  )

  it.live(
    "a non-member cannot see a space’s memory; an agent edits only its own space’s and only reads the organization’s (memory M4 to M6)",
    () =>
      Effect.gen(function* () {
        const memory = yield* Memory.Service
        const owner = yield* Seed.owner()
        const admin = { userId: owner.createdBy, organizationId: owner.organizationId, roles: ["owner"] }
        const other = yield* Seed.space(owner.organizationId)
        yield* Seed.join(other, owner.createdBy)
        const outsider = yield* Seed.actor(owner.organizationId, "member")
        const agent = asAgent(admin, owner.spaceId)
        const file = { path: "memory.md", content: "- Ship on Fridays." }
        expect((yield* Effect.flip(memory.list(outsider, { spaceId: owner.spaceId })))._tag).toBe("Primitive.NotFound")
        expect((yield* Effect.flip(memory.write(outsider, file)))._tag).toBe("Primitive.Forbidden")
        yield* memory.write(admin, file)
        expect(yield* memory.read(outsider, { path: "memory.md" })).toEqual(file)
        expect(yield* memory.read(agent, { path: "memory.md" })).toEqual(file)
        expect((yield* Effect.flip(memory.write(agent, file)))._tag).toBe("Primitive.Forbidden")
        expect((yield* Effect.flip(memory.write(agent, { ...file, spaceId: other })))._tag).toBe("Primitive.Forbidden")
        yield* memory.write(agent, { ...file, spaceId: owner.spaceId })
        expect(yield* memory.list(agent, { spaceId: other })).toEqual([])
      }),
  )
})
