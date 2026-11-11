import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Artifact } from "@ren/schema/artifact"
import { eq } from "drizzle-orm"
import { Effect, Fiber, Layer, Schema } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { SqlClient } from "effect/sql"
import { join } from "node:path"
import { ArtifactWorkerd } from "../src/artifact-provider/workerd.js"
import { Artifacts } from "../src/artifacts.js"
import { DurableRunner } from "../src/durable-runner.js"
import { TestDrives } from "./lib/drives.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"
import { ArtifactSamples } from "./lib/artifact-samples.js"

const runtime = Artifacts.layer.pipe(
  Layer.provide(ArtifactWorkerd.layer),
  Layer.provideMerge(DurableRunner.layerEffect),
  Layer.provide(TestDrives.layer),
)

const base = Layer.mergeAll(Testing.layer, FetchHttpClient.layer)
const it = testEffect(runtime.pipe(Layer.provideMerge(base)))
const recovery = testEffect(base)
const text = (value: string) => new TextEncoder().encode(value)
const deployment = () => Artifact.DeploymentID.make(crypto.randomUUID())
const artifactId = () => Artifact.ID.make(`art_${crypto.randomUUID().replaceAll("-", "")}`)

const read = (url: string) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const response = yield* http.get(url)
    return { status: response.status, body: yield* response.text }
  })

const settle = (
  artifacts: Artifacts.Interface,
  owner: Artifacts.Owner,
  id: Artifact.ID,
  deploymentId: Artifact.DeploymentID,
) =>
  Effect.gen(function* () {
    yield* idle(id)
    return yield* artifacts.status(owner, id, deploymentId)
  })

const idle = ArtifactSamples.idle

const stop = (artifacts: Artifacts.Interface, owner: Artifacts.Owner, id: Artifact.ID) =>
  Effect.gen(function* () {
    yield* artifacts.stop(owner, id)
    yield* idle(id)
  })

describe("Artifacts with durable workflows and workerd", () => {
  it.live(
    "publishes the report and server-code dashboard through Ren",
    () =>
      Effect.gen(function* () {
        const artifacts = yield* Artifacts.Service
        const owner = yield* Seed.owner()
        const id = artifactId()
        yield* Effect.addFinalizer(() => stop(artifacts, owner, id).pipe(Effect.ignore))
        const samples = yield* Effect.promise(() => ArtifactSamples.files("dashboard"))
        const report = deployment()
        yield* artifacts.deploy(owner, id, {
          title: "Report",
          deploymentId: report,
          config: { entry: "report.html" },
          files: Object.fromEntries(Object.entries(samples).filter(([path]) => path !== "_worker.js")),
        })
        const reportReady = yield* settle(artifacts, owner, id, report)
        expect(reportReady.status).toBe("ready")
        expect((yield* read(reportReady.url ?? "")).body).toContain("Quarterly operating report")
        const attempt = deployment()
        yield* artifacts.deploy(owner, id, {
          title: "Dashboard",
          deploymentId: attempt,
          config: { entry: "index.html" },
          files: samples,
        })
        const ready = yield* settle(artifacts, owner, id, attempt)
        expect(ready.status).toBe("ready")
        const origin = new URL(ready.url ?? "").origin
        yield* ArtifactSamples.pages(origin)
      }),
    120_000,
  )

  it.live(
    "keeps SQLite objects across updates and stop/redeploy",
    () =>
      Effect.gen(function* () {
        const artifacts = yield* Artifacts.Service
        const owner = yield* Seed.owner()
        const id = artifactId()
        yield* Effect.addFinalizer(() => stop(artifacts, owner, id).pipe(Effect.ignore))
        const source = yield* Effect.promise(() =>
          Bun.file(new URL("./fixtures/artifacts/state-candidate/_worker.js", import.meta.url)).text(),
        )
        const input = {
          title: "Guestbook",
          config: { entry: "index.html", durableObjects: { STATE: "SampleState" } },
          files: yield* Effect.promise(() => ArtifactSamples.files("state-candidate")),
        }
        const publish = (files = input.files) =>
          Effect.gen(function* () {
            const attempt = deployment()
            yield* artifacts.deploy(owner, id, { ...input, files, deploymentId: attempt })
            return yield* settle(artifacts, owner, id, attempt)
          })
        const first = yield* publish()
        expect(first.status).toBe("ready")
        const url = first.url ?? ""
        const origin = new URL(url).origin
        yield* ArtifactSamples.guestbook(origin)
        expect(
          (yield* publish({
            ...input.files,
            "_worker.js": text(source.replace('"1" : SAMPLE_VERSION', '"2" : SAMPLE_VERSION')),
          })).status,
        ).toBe("ready")
        yield* ArtifactSamples.retained(origin, "2")
        const broken = yield* publish({ ...input.files, "_worker.js": text("export default {") })
        expect(broken.status).toBe("failed")
        expect((yield* read(`${origin}/api/entries`)).body).toContain("Persistent")
        yield* stop(artifacts, owner, id)
        const renamed = deployment()
        yield* artifacts.deploy(owner, id, {
          ...input,
          deploymentId: renamed,
          config: { entry: "index.html", durableObjects: { STATE: "RenamedState" } },
        })
        expect((yield* settle(artifacts, owner, id, renamed)).error).toContain("removal and renaming")
        const resumed = yield* publish()
        expect(resumed.status).toBe("ready")
        expect((yield* read(`${new URL(resumed.url ?? "").origin}/api/entries`)).body).toContain("Persistent")
        const resumedOrigin = new URL(resumed.url ?? "").origin
        yield* ArtifactSamples.edit(resumedOrigin)
        const removed = deployment()
        yield* artifacts.deploy(owner, id, { ...input, config: { entry: "index.html" }, deploymentId: removed })
        expect((yield* settle(artifacts, owner, id, removed)).error).toContain("removal and renaming")
        expect((yield* read(`${new URL(resumed.url ?? "").origin}/api/entries`)).status).toBe(200)
      }),
    120_000,
  )

  it.live(
    "rolls the deployment claim and durable enqueue back together",
    () =>
      Effect.gen(function* () {
        const artifacts = yield* Artifacts.Service
        const database = yield* Database.Service
        const sql = yield* SqlClient.SqlClient
        const owner = yield* Seed.owner()
        const id = artifactId()
        const deploymentId = deployment()
        const messages = () =>
          sql<{
            readonly entity_type: string
          }>`select entity_type from cluster_messages where entity_type = 'Workflow/ArtifactDeploy' and payload::jsonb ->> 'id' = ${id}`
        yield* database
          .transaction(() =>
            Effect.gen(function* () {
              yield* artifacts.deploy(owner, id, {
                deploymentId,
                title: "Rollback",
                config: { entry: "index.html" },
                files: { "index.html": text("rolled back") },
              })
              expect((yield* messages()).length).toBe(1)
              return yield* Effect.fail("rollback")
            }),
          )
          .pipe(Effect.flip)
        expect((yield* messages()).length).toBe(0)
        expect(
          (yield* database.db.select().from(Database.Schema.artifact).where(eq(Database.Schema.artifact.id, id)))
            .length,
        ).toBe(0)
      }),
    120_000,
  )

  it.live(
    "accepts asynchronously and stops held deployment work without losing its first source",
    () =>
      Effect.gen(function* () {
        const artifacts = yield* Artifacts.Service
        const database = yield* Database.Service
        const owner = yield* Seed.owner()
        const id = artifactId()
        const deploymentId = deployment()
        const entered = Promise.withResolvers<void>()
        const released = Promise.withResolvers<void>()
        const server = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          idleTimeout: 0,
          fetch: async () => {
            entered.resolve()
            await released.promise
            return new Response("ready")
          },
        })
        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            released.resolve()
            await server.stop(true)
          }),
        )
        yield* Effect.addFinalizer(() => stop(artifacts, owner, id).pipe(Effect.ignore))
        const input = {
          deploymentId,
          title: "Pending",
          config: { entry: "_worker.js" },
          files: { "_worker.js": text(`export default { fetch: () => fetch("http://127.0.0.1:${server.port}/") }`) },
        }
        expect((yield* artifacts.deploy(owner, id, input)).status).toBe("deploying")
        yield* Effect.promise(() => entered.promise)
        expect((yield* artifacts.deploy(owner, id, input)).deploymentId).toBe(deploymentId)
        expect(
          (yield* artifacts.deploy(owner, id, { ...input, deploymentId: deployment() }).pipe(Effect.flip))._tag,
        ).toBe("Primitive.Conflict")
        const sql = yield* SqlClient.SqlClient
        const connection = yield* sql.reserve
        yield* connection.execute("BEGIN", [], undefined)
        yield* Effect.addFinalizer(() => connection.execute("ROLLBACK", [], undefined).pipe(Effect.orDie))
        yield* connection.execute("LOCK TABLE cluster_replies IN SHARE MODE", [], undefined)
        const stopping = yield* artifacts.stop(owner, id).pipe(Effect.forkScoped)
        yield* database.db
          .select({ active: Database.Schema.artifact.active_deployment_id })
          .from(Database.Schema.artifact)
          .where(eq(Database.Schema.artifact.id, id))
          .pipe(Effect.repeat({ until: (rows) => rows.at(0)?.active !== deploymentId }))
        expect((yield* artifacts.status(owner, id, deploymentId)).status).toBe("deploying")
        expect(
          (yield* artifacts.deploy(owner, id, { ...input, deploymentId: deployment() }).pipe(Effect.flip))._tag,
        ).toBe("Primitive.Conflict")
        yield* connection.execute("COMMIT", [], undefined)
        yield* Fiber.join(stopping)
        released.resolve()
        expect((yield* artifacts.status(owner, id, deploymentId)).status).toBe("stopped")
        expect(yield* artifacts.files(owner, id)).toEqual(input.files)
        expect((yield* artifacts.deploy(owner, id, input)).status).toBe("stopped")
        const row = (yield* database.db
          .select()
          .from(Database.Schema.artifact)
          .where(eq(Database.Schema.artifact.id, id))).at(0)
        expect(row?.active_deployment_id).toBeNull()
        expect(row?.url).toBeNull()
      }),
    120_000,
  )

  it.live(
    "retains successful source, config and serving app on failure, and stops only the deployment",
    () =>
      Effect.gen(function* () {
        const artifacts = yield* Artifacts.Service
        const database = yield* Database.Service
        const owner = yield* Seed.owner()
        const id = artifactId()
        const first = {
          deploymentId: deployment(),
          title: "Report",
          config: { entry: "index.html" },
          files: { "index.html": text("<h1>v1</h1>") },
        }
        let latest = first.deploymentId
        yield* Effect.addFinalizer(() => stop(artifacts, owner, id).pipe(Effect.ignore))
        yield* artifacts.deploy(owner, id, first)
        const ready = yield* settle(artifacts, owner, id, first.deploymentId)
        expect(ready.status).toBe("ready")
        const url = yield* Schema.decodeUnknownEffect(Schema.String)(ready.url)
        expect((yield* read(url)).body).toBe("<h1>v1</h1>")
        const elsewhere = yield* Seed.owner()
        expect((yield* artifacts.status(elsewhere, id, first.deploymentId).pipe(Effect.flip))._tag).toBe(
          "Primitive.NotFound",
        )
        expect((yield* artifacts.files(elsewhere, id).pipe(Effect.flip))._tag).toBe("Primitive.NotFound")
        expect((yield* artifacts.deploy(elsewhere, id, first).pipe(Effect.flip))._tag).toBe("Primitive.Conflict")
        expect((yield* artifacts.status(owner, id, deployment()).pipe(Effect.flip))._tag).toBe("Primitive.NotFound")
        const before = (yield* database.db
          .select()
          .from(Database.Schema.artifact)
          .where(eq(Database.Schema.artifact.id, id))).at(0)
        const binding = yield* Schema.decodeUnknownEffect(Schema.Struct({ directory: Schema.String }))(before?.binding)
        yield* Effect.promise(() => Bun.write(join(binding.directory, "state", "keep.txt"), "application data"))
        latest = deployment()
        yield* artifacts.deploy(owner, id, {
          deploymentId: latest,
          title: "Broken",
          config: { entry: "other.html" },
          files: { "other.html": text("bad"), "_worker.js": text("export default {") },
        })
        const failed = yield* settle(artifacts, owner, id, latest)
        expect(failed.status).toBe("failed")
        expect(failed.error).toContain("did not serve")
        expect((yield* read(url)).body).toBe("<h1>v1</h1>")
        expect(yield* artifacts.files(owner, id)).toEqual(first.files)
        const after = (yield* database.db
          .select()
          .from(Database.Schema.artifact)
          .where(eq(Database.Schema.artifact.id, id))).at(0)
        expect(after?.code_archive).toBe(before?.code_archive)
        expect(after?.config).toEqual(first.config)
        expect(after?.title).toBe(first.title)
        yield* stop(artifacts, owner, id)
        expect(yield* artifacts.files(owner, id)).toEqual(first.files)
        expect(yield* Effect.promise(() => Bun.file(join(binding.directory, "state", "keep.txt")).text())).toBe(
          "application data",
        )
        expect(yield* Effect.promise(() => Bun.file(join(binding.directory, "serving.json")).exists())).toBe(false)
        const stopped = (yield* database.db
          .select()
          .from(Database.Schema.artifact)
          .where(eq(Database.Schema.artifact.id, id))).at(0)
        expect(stopped?.binding).toBeNull()
        expect(stopped?.url).toBeNull()
        expect(yield* read(url).pipe(Effect.isFailure)).toBe(true)
        latest = deployment()
        yield* artifacts.deploy(owner, id, { ...first, deploymentId: latest })
        const resumed = yield* settle(artifacts, owner, id, latest)
        expect(resumed.status).toBe("ready")
        expect((yield* read(resumed.url ?? "")).body).toBe("<h1>v1</h1>")
        yield* stop(artifacts, owner, id)
        expect(yield* read(resumed.url ?? "").pipe(Effect.isFailure)).toBe(true)
      }),
    120_000,
  )

  recovery.live(
    "recovers the durable input after the runner exits during deployment",
    () =>
      Effect.gen(function* () {
        const owner = yield* Seed.owner()
        const id = artifactId()
        const deploymentId = deployment()
        const first = Promise.withResolvers<void>()
        const resumed = Promise.withResolvers<void>()
        const released = Promise.withResolvers<void>()
        let restarted = false
        const server = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          idleTimeout: 0,
          fetch: async () => {
            if (restarted) resumed.resolve()
            else first.resolve()
            await released.promise
            return new Response("recovered")
          },
        })
        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            released.resolve()
            await server.stop(true)
          }),
        )
        yield* Effect.gen(function* () {
          const artifacts = yield* Artifacts.Service
          yield* artifacts.deploy(owner, id, {
            deploymentId,
            title: "Recovery",
            config: { entry: "_worker.js" },
            files: { "_worker.js": text(`export default { fetch: () => fetch("http://127.0.0.1:${server.port}/") }`) },
          })
          yield* Effect.promise(() => first.promise)
          expect((yield* artifacts.status(owner, id, deploymentId)).status).toBe("deploying")
        }).pipe(Effect.scoped, Effect.provide(Layer.fresh(runtime)))
        restarted = true
        yield* Effect.gen(function* () {
          const artifacts = yield* Artifacts.Service
          yield* Effect.addFinalizer(() => stop(artifacts, owner, id).pipe(Effect.ignore))
          yield* Effect.promise(() => resumed.promise)
          released.resolve()
          const ready = yield* settle(artifacts, owner, id, deploymentId)
          expect(ready.status).toBe("ready")
          expect((yield* read(ready.url ?? "")).body).toBe("recovered")
        }).pipe(Effect.scoped, Effect.provide(Layer.fresh(runtime)))
      }),
    120_000,
  )
})
