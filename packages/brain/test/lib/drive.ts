export * as TestDrive from "./drive.js"

import { TestHand } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Hand } from "@ren/schema/hand"
import { Session } from "@ren/schema/session"
import { Context, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { mkdir, mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { HandClient } from "@ren/hand-api/hand-client"
import { HandConnections } from "../../src/hand/connections.js"
import { DriveFiles } from "../../src/reference/drive-files.js"
import { TestAccess } from "./access.js"

const environmentId = Hand.ID.create()

export const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-environment-")))

export const layer = TestHand.layer({ environmentId, workspace })

export const pdf = (bytes: number) =>
  new Uint8Array([...new TextEncoder().encode("%PDF-1.7\n"), ...new Uint8Array(bytes)])

export const driveOf = Effect.fnUntraced(function* (files: Readonly<Record<string, string | Uint8Array>>) {
  const sessionId = Session.ID.create()
  const root = join(workspace, sessionId, "drive")
  yield* Effect.promise(() =>
    Promise.all(
      Object.entries(files).map(async ([path, body]) => {
        await mkdir(dirname(join(root, path)), { recursive: true })
        await Bun.write(join(root, path), body)
      }),
    ),
  )
  const access = yield* Effect.flatMap(TestHand.url, (url) =>
    TestHand.access({
      url,
      environmentId,
      brain: Brain.ofSession(sessionId),
      directory: join(workspace, sessionId),
      generation: 1,
    }),
  )
  const context = yield* Layer.build(TestAccess.memory(new Map([[sessionId, access]])))
  const connections = Context.get(
    yield* Layer.build(
      HandConnections.layer.pipe(Layer.provide(Layer.succeedContext(context)), Layer.provide(FetchHttpClient.layer)),
    ),
    HandConnections.Service,
  )
  const connected = <A, E>(use: (client: HandClient.Client) => Effect.Effect<A, E>) =>
    connections.connect(sessionId).pipe(
      Effect.flatMap((connection) => use(connection.client)),
      Effect.scoped,
    )
  return {
    root,
    sessionId,
    attach: (attached: ReadonlyArray<Session.DriveFile>) =>
      connected((client) => DriveFiles.attach(client, root, attached)),
    show: (source: string) => connected((client) => DriveFiles.show(client, root, sessionId, source)),
  }
})
