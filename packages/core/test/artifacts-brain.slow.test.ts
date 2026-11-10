import { describe, expect, setDefaultTimeout } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Session } from "@ren/schema/session"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { ArtifactWorkerd } from "../src/artifact-provider/workerd.js"
import { Artifacts } from "../src/artifacts.js"
import { BrainRegistry } from "../src/brain-registry.js"
import { Brains } from "../src/brains.js"
import { SessionRunner } from "../src/session/runner.js"
import { Configured } from "./lib/configured.js"
import { TestDrives } from "./lib/drives.js"
import { testEffect } from "./lib/effect.js"
import { Host } from "./lib/host.js"
import { Seed } from "./lib/seed.js"

setDefaultTimeout(120_000)

const stub = Configured.stub

const it = testEffect(
  Layer.mergeAll(
    SessionRunner.layer.pipe(
      Layer.provideMerge(BrainRegistry.layer),
      Layer.provideMerge(Host.layer({}, Configured.models)),
      Layer.provideMerge(
        Artifacts.layer.pipe(
          Layer.provide(ArtifactWorkerd.layer),
          Layer.provideMerge(FetchHttpClient.layer),
          Layer.provide(TestDrives.layer),
        ),
      ),
      Layer.provideMerge(Host.runner),
    ),
    Host.runner,
  ).pipe(Layer.provideMerge(Testing.layer)),
)

const create = (code: string) => ({ tool: { name: "execute", input: { code } } })

describe("artifacts from a chat", () => {
  it.live("a chat on a local brain publishes an artifact that Ren serves at its URL, and updates it there", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionRunner.Service
      const database = yield* Database.Service
      const artifacts = yield* Artifacts.Service
      const http = yield* HttpClient.HttpClient
      const owner = yield* Seed.owner()
      const sessionId = Session.ID.create()
      const published = stub.script(
        create(
          'return await tools.opencode.artifact_create({ title: "Report", files: { "index.html": "<h1>from a chat</h1>" } })',
        ),
      )
      yield* sessions.create(owner, {
        sessionId,
        harness: "opencode",
        interactive: true,
        initialMessage: {
          messageId: Session.MessageID.create(),
          prompt: { text: `publish ${published.marker}` },
          sender: { userId: owner.createdBy },
        },
      })
      const answered = yield* Effect.promise(() => published.called(2))
      const row = (yield* database.db
        .select()
        .from(Database.Schema.artifact)
        .where(eq(Database.Schema.artifact.space_id, owner.spaceId))).at(0)
      if (!row) return yield* Effect.die(new Error(`No artifact was published: ${answered.text}`))
      yield* Effect.addFinalizer(() => artifacts.stop(owner, row.id).pipe(Effect.ignore))
      expect(JSON.stringify(answered.body)).toContain(row.id)
      expect(JSON.stringify(answered.body)).toContain("Deployment accepted")
      const completed = yield* Effect.promise(() =>
        stub.waitFor((call) => call.text.includes("Artifact deployment result:") && call.text.includes(row.id)),
      )
      expect(completed.text).toContain('"status":"ready"')
      const deployed = (yield* database.db
        .select()
        .from(Database.Schema.artifact)
        .where(eq(Database.Schema.artifact.id, row.id))).at(0)
      const url = deployed?.url ?? ""
      expect(yield* http.get(url).pipe(Effect.flatMap((response) => response.text))).toBe("<h1>from a chat</h1>")

      const updated = stub.script(
        create(
          `return await tools.opencode.artifact_update({ id: "${row.id}", files: { "index.html": "<h1>updated</h1>" } })`,
        ),
      )
      const brains = yield* Brains.Service
      yield* brains.send({
        sessionId,
        messageId: Session.MessageID.create(),
        prompt: { text: `update ${updated.marker}` },
        delivery: "steer",
        sender: { userId: owner.createdBy },
      })
      yield* Effect.promise(() => updated.called(2))
      yield* Effect.promise(() =>
        stub.waitFor(
          (call) =>
            call.text !== completed.text &&
            call.text.includes("Artifact deployment result:") &&
            call.text.includes(row.id),
        ),
      )
      expect(yield* http.get(url).pipe(Effect.flatMap((response) => response.text))).toBe("<h1>updated</h1>")
    }),
  )
})
