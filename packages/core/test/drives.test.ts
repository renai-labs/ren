import { describe, expect } from "bun:test"
import { Testing } from "@ren/db/testing"
import { Agent } from "@ren/schema/agent"
import { FileSystem } from "@ren/schema/file-system"
import { Session } from "@ren/schema/session"
import { DateTime, Effect, Layer } from "effect"
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
        const root = yield* drives.fileSystem.list(found.ada, { spaceId })
        expect(root).toEqual({
          entries: [
            { path: "reports/", type: "directory" },
            { path: "notes.md", type: "file", size: 2, modifiedAt: expect.anything(), mime: "text/markdown" },
          ],
          cursor: null,
          actions: ["upload", "remove"],
        })
        const reports = yield* drives.fileSystem.list(found.ada, { spaceId, folder: "reports/" })
        expect(reports.entries.map((entry) => entry.path)).toEqual(["reports/q3.txt"])
        expect(yield* drives.fileSystem.read(found.ada, { spaceId, path: "reports/q3.txt" })).toEqual({
          path: "reports/q3.txt",
          mime: "text/plain",
          size: 5,
          encoding: "utf8",
          content: "third",
          truncated: false,
        })
        const link = yield* drives.download(found.ada, { spaceId, path: "reports/q3.txt" })
        expect(yield* TestDrives.download(link.url)).toMatchObject({
          text: "third",
          uploadedBy: found.ada.userId,
          disposition: "attachment; filename*=UTF-8''q3.txt",
        })
        const shown = yield* drives.download(found.ada, { spaceId, path: "reports/q3.txt", disposition: "inline" })
        expect(yield* TestDrives.download(shown.url)).toMatchObject({
          disposition: "inline; filename*=UTF-8''q3.txt",
          type: "text/plain;charset=utf-8",
        })
        yield* drives.fileSystem.remove(found.ada, { spaceId, path: "reports/q3.txt" })
        expect((yield* drives.fileSystem.list(found.ada, { spaceId })).entries.map((entry) => entry.path)).toEqual([
          "notes.md",
        ])
        expect((yield* Effect.flip(drives.download(found.ada, { spaceId, path: "reports/q3.txt" })))._tag).toBe(
          "Primitive.NotFound",
        )
        expect((yield* drives.fileSystem.list(found.ada, {})).entries).toEqual([])
        expect(
          yield* Effect.flip(drives.fileSystem.list(found.ada, { spaceId, cursor: "not-a-cursor" })),
        ).toMatchObject({ _tag: "Primitive.Invalid", field: "cursor" })
      }),
  )

  it.live("a drive file reads as text when it is UTF-8 and as base64 otherwise, cut at the read limit", () =>
    Effect.gen(function* () {
      const drives = yield* Drives.Service
      const found = yield* ownerActor
      const spaceId = found.owner.spaceId
      const owner = { organizationId: found.owner.organizationId, spaceId }
      yield* drives.put(owner, "logo.png", new Uint8Array([137, 80, 0, 255]), "image/png")
      yield* drives.put(owner, "empty.txt", new Uint8Array(), "text/plain")
      yield* drives.put(owner, "large.txt", new Uint8Array(FileSystem.readLimit + 1).fill(97), "text/plain")
      expect(yield* drives.fileSystem.read(found.ada, { spaceId, path: "logo.png" })).toEqual({
        path: "logo.png",
        mime: "image/png",
        size: 4,
        encoding: "base64",
        content: "iVAA/w==",
        truncated: false,
      })
      expect(yield* drives.fileSystem.read(found.ada, { spaceId, path: "empty.txt" })).toMatchObject({
        size: 0,
        encoding: "utf8",
        content: "",
        truncated: false,
      })
      const large = yield* drives.fileSystem.read(found.ada, { spaceId, path: "large.txt" })
      expect([large.size, large.encoding, large.content.length, large.truncated]).toEqual([
        FileSystem.readLimit + 1,
        "utf8",
        FileSystem.readLimit,
        true,
      ])
      expect((yield* Effect.flip(drives.fileSystem.read(found.ada, { spaceId, path: "missing.txt" })))._tag).toBe(
        "Primitive.NotFound",
      )
      expect((yield* Effect.flip(drives.fileSystem.read(found.ada, { spaceId, path: "../x" })))._tag).toBe(
        "Primitive.Invalid",
      )
    }),
  )

  it.live(
    "Ren puts a file in a space's drive with no size limit, lists every file under a folder with its time, and reads one back",
    () =>
      Effect.gen(function* () {
        const drives = yield* Drives.Service
        const found = yield* ownerActor
        const owner = { organizationId: found.owner.organizationId, spaceId: found.owner.spaceId }
        const before = yield* DateTime.now
        const path = "chats/ses_1/uploads/msg_1/trace.log"
        const body = new Uint8Array(TestDrives.maxFileBytes + 1).fill(97)
        yield* drives.put(owner, path, body, "text/plain")
        yield* drives.put(owner, "chats/ses_2/uploads/msg_1/other.txt", new Uint8Array(1), "text/plain")
        const listed = yield* drives.files(owner, "chats/ses_1")
        expect(listed.map((file) => [file.path, file.size])).toEqual([[path, body.length]])
        expect(
          DateTime.isGreaterThanOrEqualTo(listed[0]?.modifiedAt ?? before, DateTime.subtract(before, { seconds: 5 })),
        ).toBe(true)
        expect(yield* drives.read(owner, path)).toEqual(body)
        expect((yield* Effect.flip(drives.read(owner, "chats/ses_1/missing.txt")))._tag).toBe("Primitive.NotFound")
        expect(
          (yield* drives.fileSystem.list(found.ada, {
            spaceId: owner.spaceId,
            folder: "chats/ses_1/uploads/msg_1",
          })).entries.map((entry) => entry.path),
        ).toEqual([path])
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
      expect((yield* drives.fileSystem.list(found.ada, { spaceId })).entries).toEqual([])
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
        const files = drives.fileSystem
        expect((yield* Effect.flip(files.list(outsider, { spaceId })))._tag).toBe("Primitive.NotFound")
        expect((yield* Effect.flip(files.list(found.ada, { spaceId: other })))._tag).toBe("Primitive.NotFound")
        expect((yield* Effect.flip(files.read(outsider, { spaceId, path: "a.txt" })))._tag).toBe("Primitive.NotFound")
        yield* TestDrives.post(yield* drives.startUpload(outsider, { path: "handbook.md", size: 2 }), "ok")
        const organization = yield* files.list(outsider, {})
        expect([organization.entries.map((entry) => entry.path), organization.actions]).toEqual([
          ["handbook.md"],
          ["upload", "remove"],
        ])
        expect((yield* Effect.flip(files.list(agent, { spaceId })))._tag).toBe("Primitive.Forbidden")
        expect((yield* Effect.flip(files.list(agent, {})))._tag).toBe("Primitive.Forbidden")
        expect((yield* Effect.flip(files.remove(agent, { path: "handbook.md" })))._tag).toBe("Primitive.Forbidden")
      }),
  )
})
