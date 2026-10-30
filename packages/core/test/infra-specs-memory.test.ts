import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { ChannelProvider } from "../src/channel-provider.js"
import { InfraSpecs } from "../src/infra-specs.js"
import { Memory } from "../src/memory.js"
import { Space } from "../src/space.js"
import { testEffect } from "./lib/effect.js"
import { InfraFixture } from "./lib/infra.js"

const it = testEffect(InfraFixture.layer(ChannelProvider.layer(Effect.succeed([]))))

const change = InfraFixture.change

describe("InfraSpecs memory", () => {
  it.live(
    "pull writes each memory with its memory.md; apply writes only what the folder adds or changes, and never deletes",
    () =>
      Effect.gen(function* () {
        const infra = yield* InfraSpecs.Service
        const memory = yield* Memory.Service
        const o = yield* InfraFixture.org
        const spaceId = o.home.id
        yield* memory.write(o.admin, { path: "memory.md", content: "- Ship on Fridays.\n" })
        yield* memory.write(o.admin, { spaceId, path: "people/ana.md", content: "Ana leads design.\n" })

        const pulled = yield* infra.pull(o.admin, {})

        expect(pulled.spec.memory).toEqual({ "memory.md": "- Ship on Fridays.\n" })
        expect(pulled.spec.spaces["home"]?.memory).toEqual({ "memory.md": "", "people/ana.md": "Ana leads design.\n" })
        expect(pulled.write.filter((path) => path.includes("memory/"))).toEqual([
          "memory/memory.md",
          "spaces/home/memory/memory.md",
          "spaces/home/memory/people/ana.md",
        ])
        expect(yield* infra.plan(o.admin, yield* InfraFixture.replan(pulled))).toMatchObject({
          changes: [],
          problems: [],
        })

        const input = {
          ...(yield* InfraFixture.replan(pulled)),
          spec: InfraFixture.spec(
            { home: { name: "Home", memory: { "memory.md": "- Ana and Bo.\n", "projects/ren.md": "Ren ships.\n" } } },
            {},
            { "memory.md": "- Ship on Thursdays.\n" },
          ),
        }
        const plan = yield* infra.plan(o.admin, input)

        expect(plan.problems).toEqual([])
        expect(InfraFixture.withoutValues(plan.changes)).toEqual([
          change("update", "memory", "memory/memory.md", { fields: ["content"] }),
          change("create", "memory", "spaces/home/memory/memory.md"),
          change("create", "memory", "spaces/home/memory/projects/ren.md"),
        ])
        const applied = yield* infra.apply(o.admin, { ...input, digest: plan.digest })
        expect(yield* memory.read(o.admin, { path: "memory.md" })).toEqual({
          path: "memory.md",
          content: "- Ship on Thursdays.\n",
        })
        expect(yield* memory.list(o.admin, { spaceId })).toEqual(["memory.md", "people/ana.md", "projects/ren.md"])

        yield* memory.delete(o.admin, { spaceId, path: "projects/ren.md" })
        expect(
          yield* infra.pull(o.admin, { spec: input.spec, bindings: input.bindings, lock: applied.lock }),
        ).toMatchObject({
          write: ["spaces/home/memory/people/ana.md"],
          remove: ["spaces/home/memory/projects/ren.md"],
          conflicts: [],
        })
      }),
  )

  it.live("an edit in Ren since the pull stays, and an edit in Ren and in the folder is a conflict", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const memory = yield* Memory.Service
      const o = yield* InfraFixture.org
      const spaceId = o.home.id
      yield* memory.write(o.admin, { spaceId, path: "memory.md", content: "- Ana leads design.\n" })
      yield* memory.write(o.admin, { spaceId, path: "notes.md", content: "- Ship on Fridays.\n" })
      const folder = yield* InfraFixture.pulled(o.admin)
      yield* memory.write(o.admin, { spaceId, path: "memory.md", content: "- Ana leads research.\n" })
      yield* memory.write(o.admin, { spaceId, path: "notes.md", content: "- Ship on Mondays.\n" })
      yield* memory.write(o.admin, { spaceId, path: "learned.md", content: "- Bo joined.\n" })
      const input = {
        ...folder,
        spec: InfraFixture.spec({
          home: { name: "Home", memory: { "memory.md": "- Ana leads sales.\n", "notes.md": "- Ship on Fridays.\n" } },
        }),
      }

      const plan = yield* infra.plan(o.admin, input)

      expect(plan.changes).toEqual([
        change("update", "memory", "spaces/home/memory/memory.md", {
          status: "conflict",
          fields: ["content"],
          values: [{ field: "content", ren: "- Ana leads research.\n", folder: "- Ana leads sales.\n" }],
        }),
        change("update", "memory", "spaces/home/memory/notes.md", {
          status: "changed",
          fields: ["content"],
          values: [{ field: "content", ren: "- Ship on Mondays.\n", folder: "- Ship on Fridays.\n" }],
        }),
      ])
      expect((yield* infra.apply(o.admin, { ...input, digest: plan.digest }).pipe(Effect.flip))._tag).toBe(
        "Primitive.Conflict",
      )

      yield* infra.apply(o.admin, { ...input, digest: plan.digest, force: true })

      const files = yield* Effect.forEach(yield* memory.list(o.admin, { spaceId }), (path) =>
        memory.read(o.admin, { spaceId, path }),
      )
      expect(files).toEqual([
        { path: "learned.md", content: "- Bo joined.\n" },
        { path: "memory.md", content: "- Ana leads sales.\n" },
        { path: "notes.md", content: "- Ship on Mondays.\n" },
      ])
    }),
  )

  it.live("a space and its memory declared together are created in one apply", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const o = yield* InfraFixture.org
      const input = {
        bindings: o.bindings,
        spec: InfraFixture.spec({
          home: { name: "Home" },
          design: { name: "Design", memory: { "memory.md": "- Draw.\n", "people/bo.md": "Bo draws.\n" } },
        }),
      }

      const plan = yield* infra.plan(o.admin, input)

      expect(plan.problems).toEqual([])
      expect(InfraFixture.withoutValues(plan.changes)).toEqual([
        change("create", "space", "spaces/design"),
        change("create", "memory", "spaces/design/memory/memory.md"),
        change("create", "memory", "spaces/design/memory/people/bo.md"),
      ])
      yield* infra.apply(o.admin, { ...input, digest: plan.digest })
      expect((yield* infra.pull(o.admin, {})).spec.spaces["design"]?.memory).toEqual({
        "memory.md": "- Draw.\n",
        "people/bo.md": "Bo draws.\n",
      })
    }),
  )

  it.live("a folder that drops a space archives it without a conflict, and its memory stays", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const memory = yield* Memory.Service
      const spaces = yield* Space.Service
      const database = yield* Database.Service
      const o = yield* InfraFixture.org
      const eng = yield* spaces.create(o.admin, { name: "Engineering", slug: "engineering" })
      yield* memory.write(o.admin, { spaceId: eng.id, path: "notes.md", content: "- Ship.\n" })
      const input = { ...(yield* InfraFixture.pulled(o.admin)), spec: InfraFixture.spec({ home: { name: "Home" } }) }

      const pulled = yield* infra.pull(o.admin, input)
      const plan = yield* infra.plan(o.admin, input)

      expect(pulled).toMatchObject({ remove: [], conflicts: [] })
      expect(pulled.write.filter((path) => path.startsWith("spaces/engineering"))).toEqual([])
      expect(plan.changes).toEqual([change("archive", "space", "spaces/engineering")])
      yield* infra.apply(o.admin, { ...input, digest: plan.digest })
      expect(
        yield* database.db
          .select({ files: Database.Schema.memory.files })
          .from(Database.Schema.memory)
          .where(eq(Database.Schema.memory.space_id, eng.id)),
      ).toEqual([{ files: { "notes.md": "- Ship.\n" } }])
    }),
  )
})
