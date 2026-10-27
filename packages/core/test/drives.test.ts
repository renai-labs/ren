import { describe, expect } from "bun:test"
import { Testing } from "@ren/db/testing"
import { Agent } from "@ren/schema/agent"
import { Session } from "@ren/schema/session"
import { Effect, Layer } from "effect"
import { Access } from "../src/access.js"
import type { Actor } from "../src/actor.js"
import { Drives } from "../src/drives.js"
import { TestDrives } from "./lib/drives.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(
  Drives.layer.pipe(
    Layer.provideMerge(Access.layer),
    Layer.provideMerge(Testing.layer),
    Layer.provide(TestDrives.layer),
  ),
)

const ownerActor = Effect.map(Seed.owner(), (owner) => ({
  owner,
  ada: { userId: owner.createdBy, organizationId: owner.organizationId, roles: ["owner"] } satisfies Actor.Info,
}))

describe("Drives", () => {
  it.live(
    "a member uploads with the form that startUpload gives, which records them, lists a folder, downloads and deletes",
    () =>
      Effect.gen(function* () {
        const drives = yield* Drives.Service
        const found = yield* ownerActor
        const spaceId = found.owner.spaceId
        const upload = yield* drives.startUpload(found.ada, { spaceId, path: "reports/q3.txt", size: 5 })
        expect(yield* TestDrives.post(upload, "third")).toEqual({ status: 204, code: undefined })
        yield* TestDrives.post(yield* drives.startUpload(found.ada, { spaceId, path: "notes.md", size: 2 }), "hi")
        const root = yield* drives.list(found.ada, { spaceId })
        expect(root.folders).toEqual(["reports"])
        expect(root.files.map((file) => [file.path, file.size])).toEqual([["notes.md", 2]])
        expect(root.cursor).toBeNull()
        const reports = yield* drives.list(found.ada, { spaceId, folder: "reports" })
        expect(reports.files.map((file) => file.path)).toEqual(["reports/q3.txt"])
        const link = yield* drives.download(found.ada, { spaceId, path: "reports/q3.txt" })
        expect(yield* TestDrives.download(link.url)).toEqual({ text: "third", uploadedBy: found.ada.userId })
        yield* drives.delete(found.ada, { spaceId, path: "reports/q3.txt" })
        expect((yield* drives.list(found.ada, { spaceId })).folders).toEqual([])
        expect((yield* Effect.flip(drives.download(found.ada, { spaceId, path: "reports/q3.txt" })))._tag).toBe(
          "Primitive.NotFound",
        )
        expect((yield* drives.list(found.ada, {})).files).toEqual([])
      }),
  )

  it.live("an upload is exactly its size, at most DRIVE_MAX_FILE_SIZE, and only to its path", () =>
    Effect.gen(function* () {
      const drives = yield* Drives.Service
      const found = yield* ownerActor
      const spaceId = found.owner.spaceId
      const upload = yield* drives.startUpload(found.ada, { spaceId, path: "a.txt", size: 3 })
      expect(yield* TestDrives.post(upload, "four")).toEqual({ status: 400, code: "EntityTooLarge" })
      expect(yield* TestDrives.post(upload, "tw")).toEqual({ status: 400, code: "EntityTooSmall" })
      const moved = {
        uploadUrl: upload.uploadUrl,
        fields: Object.fromEntries(
          Object.entries(upload.fields).map(([name, value]) => [
            name,
            name === "key" ? value.replace("a.txt", "b.txt") : value,
          ]),
        ),
      }
      expect((yield* TestDrives.post(moved, "one")).status).toBeGreaterThanOrEqual(400)
      expect((yield* drives.list(found.ada, { spaceId })).files).toEqual([])
      const large = yield* Effect.flip(
        drives.startUpload(found.ada, { spaceId, path: "large.bin", size: TestDrives.maxFileBytes + 1 }),
      )
      expect(large).toMatchObject({ _tag: "Primitive.Invalid", field: "size" })
    }),
  )

  it.live(
    "only members use a space's drive, every person in the organization uses its drive, and an agent uses neither",
    () =>
      Effect.gen(function* () {
        const drives = yield* Drives.Service
        const found = yield* ownerActor
        const other = yield* Seed.space(found.owner.organizationId)
        const outsider = yield* Seed.actor(found.owner.organizationId, "member")
        const agent: Actor.Info = {
          ...found.ada,
          agent: {
            agentId: Agent.ID.create(),
            sessionId: Session.ID.create(),
            spaceId: found.owner.spaceId,
            fence: null,
          },
        }
        const spaceId = found.owner.spaceId
        expect((yield* Effect.flip(drives.list(outsider, { spaceId })))._tag).toBe("Primitive.NotFound")
        expect((yield* Effect.flip(drives.list(found.ada, { spaceId: other })))._tag).toBe("Primitive.NotFound")
        yield* TestDrives.post(yield* drives.startUpload(outsider, { path: "handbook.md", size: 2 }), "ok")
        expect((yield* drives.list(found.ada, {})).files.map((file) => file.path)).toEqual(["handbook.md"])
        expect((yield* Effect.flip(drives.list(agent, { spaceId })))._tag).toBe("Primitive.Forbidden")
        expect((yield* Effect.flip(drives.list(agent, {})))._tag).toBe("Primitive.Forbidden")
      }),
  )
})
