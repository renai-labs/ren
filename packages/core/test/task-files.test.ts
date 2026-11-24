import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Drive } from "@ren/schema/drive"
import { Effect, Layer } from "effect"
import { Drives } from "../src/drives.js"
import { SpaceMember } from "../src/space/member.js"
import { Task } from "../src/task.js"
import { TaskFiles } from "../src/task/files.js"
import { TestDrives } from "./lib/drives.js"
import { TaskFixture } from "./lib/task-fixture.js"

const it = TaskFixture.harness().it

describe("TaskFiles", () => {
  it.live(
    "a task's folder follows it to the space it is in now, even when the runs of two moves end out of order",
    () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const drives = yield* Effect.provide(
          Effect.gen(function* () {
            return yield* Drives.Service
          }),
          Drives.layer.pipe(Layer.provide(TestDrives.layer)),
        )
        const tasks = yield* Task.Service
        const o = yield* TaskFixture.org
        const members = yield* SpaceMember.Service
        yield* members.create(o.grace, { spaceId: o.eng.id, userId: o.ada.userId })
        const task = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Fix the login page" })
        const folder = Drive.taskFolder(task.identifier)
        const factory = { organizationId: o.organizationId, spaceId: o.factory.id }
        const eng = { organizationId: o.organizationId, spaceId: o.eng.id }
        yield* drives.put(factory, `${folder}/shot.png`, new TextEncoder().encode("png"), "image/png")
        const moveTo = (spaceId: typeof o.eng.id) => tasks.assign(o.ada, task.id, { spaceId, start: "none" })
        const settle = (fromSpaceId: typeof o.eng.id) =>
          TaskFiles.settle(database, drives, { organizationId: o.organizationId, taskId: task.id, fromSpaceId })
        const paths = (owner: typeof eng) =>
          drives.files(owner, folder).pipe(Effect.map((files) => files.map((file) => file.path)))
        yield* moveTo(o.eng.id)
        yield* settle(o.factory.id)
        expect([yield* paths(factory), yield* paths(eng)]).toEqual([[], [`${folder}/shot.png`]])
        yield* moveTo(o.factory.id)
        yield* moveTo(o.eng.id)
        yield* settle(o.factory.id)
        yield* settle(o.eng.id)
        expect([yield* paths(factory), yield* paths(eng)]).toEqual([[], [`${folder}/shot.png`]])
      }),
  )
})
