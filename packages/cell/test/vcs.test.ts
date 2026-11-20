import { expect } from "bun:test"
import { TestAccess } from "@ren/brain/testing"
import { HandConnections } from "@ren/brain/hand/connections"
import { TestHand, testEffect } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Hand } from "@ren/schema/hand"
import { Session } from "@ren/schema/session"
import { Context, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RenVcs } from "../src/harness/opencode/vcs.js"
import { RenWorkspaceDriver } from "../src/harness/opencode/workspace-driver.js"

const environmentId = Hand.ID.create()
const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-vcs-")))
const it = testEffect(TestHand.layer({ environmentId, workspace }))

const repository = async (folder: string) => {
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, "index.ts"), "export const a = 1\n")
  await Bun.$`git init -q -b main && git add . && git -c user.name=Ren -c user.email=ren@example.com commit -qm first`.cwd(
    folder,
  )
}

const spawnerFor = Effect.fnUntraced(function* (sessionId: Session.ID) {
  const access = yield* TestHand.access({
    url: yield* TestHand.url,
    environmentId,
    brain: Brain.ofSession(sessionId),
    directory: join(workspace, sessionId),
  })
  const connections = yield* Layer.build(
    HandConnections.layer.pipe(
      Layer.provide(TestAccess.fixed(new Map([[sessionId, access]]))),
      Layer.provide(FetchHttpClient.layer),
    ),
  ).pipe(Effect.map((context) => Context.get(context, HandConnections.Service)))
  return RenWorkspaceDriver.session(connections, sessionId).spawner
})

it.live("finds the repositories below a session's folder and reads the branch and diff of one", () =>
  Effect.gen(function* () {
    const sessionId = Session.ID.create()
    const folder = join(workspace, sessionId)
    yield* Effect.promise(async () => {
      await mkdir(folder, { recursive: true })
      await writeFile(join(folder, "notes.txt"), "notes\n")
      await repository(join(folder, "app"))
      await repository(join(folder, "libs", "tool"))
      await repository(join(folder, "node_modules", "dependency"))
      await writeFile(join(folder, "app", "index.ts"), "export const a = 2\n")
    })
    const spawner = yield* spawnerFor(sessionId)
    expect(yield* RenVcs.projects(spawner, folder)).toEqual([
      { path: "app/", branch: "main" },
      { path: "libs/tool/", branch: "main" },
    ])
    expect(yield* RenVcs.make(spawner, folder).info()).toEqual({ branch: {} })
    const app = RenVcs.make(spawner, join(folder, "app"))
    expect(yield* app.info()).toEqual({ provider: "git", branch: { current: "main", default: "main" } })
    expect((yield* app.diff("working")).map((file) => [file.file, file.status])).toEqual([["index.ts", "modified"]])
  }),
)
