import { describe, expect } from "bun:test"
import { ListObjectsV2Command } from "@aws-sdk/client-s3"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Artifact } from "@ren/schema/artifact"
import { Identifier } from "@ren/schema/identifier"
import { eq } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Predicate, Schema } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { SqlClient } from "effect/sql"
import { chmod } from "node:fs/promises"
import { join } from "node:path"
import { ArtifactProvider } from "../src/artifact-provider.js"
import { ArtifactWorkerd } from "../src/artifact-provider/workerd.js"
import { Access } from "../src/access.js"
import { Artifacts } from "../src/artifacts.js"
import { DurableRunner } from "../src/durable-runner.js"
import { Models } from "../src/models.js"
import { Host } from "./lib/host.js"
import { ObjectStorage } from "../src/object-storage.js"
import { TestDrives } from "./lib/drives.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"
import { ArtifactSamples } from "./lib/artifact-samples.js"

// oxlint-disable-next-line ren/no-comments -- Ren sends a run's result to its chat on the brain at cellUrl; nothing answers on port 9 unless a test names a server.
const runtimeWith = (cellUrl: string) =>
  Artifacts.layer.pipe(
    Layer.provide([ArtifactWorkerd.layer, Access.layer]),
    Layer.provideMerge(
      Host.cellLayerWith(DurableRunner.layerEffect)({ CELL_URL: cellUrl }, Models.layerNone, Host.noTemplates),
    ),
    Layer.provideMerge(DurableRunner.layerEffect),
    Layer.provide(TestDrives.layer),
  )

const runtime = runtimeWith("http://127.0.0.1:9")

// oxlint-disable-next-line ren/no-comments -- The names of the workerd provider, kept in memory. remove waits while a test holds it, so a test can make a write land late.
const names = new Map<string, string>()
const removes: {
  hold?: { readonly entered: PromiseWithResolvers<void>; readonly release: PromiseWithResolvers<void> }
} = {}
const named = testEffect(
  Artifacts.layer.pipe(
    Layer.provide([
      Layer.effect(
        ArtifactProvider.Service,
        Effect.map(ArtifactProvider.Service, (provider) => ({
          ...provider,
          names: {
            origin: (id: Artifact.ID, name: Artifact.Name | null) => `https://${name ?? Artifact.label(id)}.example`,
            put: (name: Artifact.Name, id: Artifact.ID) => Effect.sync(() => void names.set(name, Artifact.label(id))),
            remove: (name: Artifact.Name) =>
              Effect.gen(function* () {
                const hold = removes.hold
                delete removes.hold
                if (hold) {
                  hold.entered.resolve()
                  yield* Effect.promise(() => hold.release.promise)
                }
                names.delete(name)
              }),
          },
        })),
      ).pipe(Layer.provide(ArtifactWorkerd.layer)),
      Access.layer,
    ]),
    Layer.provideMerge(
      Host.cellLayerWith(DurableRunner.layerEffect)(
        { CELL_URL: "http://127.0.0.1:9" },
        Models.layerNone,
        Host.noTemplates,
      ),
    ),
    Layer.provideMerge(DurableRunner.layerEffect),
    Layer.provide(TestDrives.layer),
    Layer.provideMerge(Layer.mergeAll(Testing.layer, FetchHttpClient.layer)),
  ),
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

// oxlint-disable-next-line ren/no-comments -- A Worker whose answer waits for release, so its deployment holds in the provider's readiness check.
const held = Effect.gen(function* () {
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
  return {
    files: { "_worker.js": text(`export default { fetch: () => fetch("http://127.0.0.1:${server.port}/") }`) },
    entered: Effect.promise(() => entered.promise),
    release: Effect.sync(() => released.resolve()),
  }
})

describe("Artifacts with durable workflows and workerd", () => {
  it.live("an upload link names no checksum, which S3 and R2 would hold the archive to", () =>
    Effect.gen(function* () {
      const artifacts = yield* Artifacts.Service
      const owner = yield* ArtifactSamples.owner()
      const upload = yield* artifacts.upload(owner, artifactId())
      expect([...new URL(upload.url).searchParams.keys()].filter((key) => key.includes("checksum"))).toEqual([])
    }),
  )

  it.live("a refused archive fails its deployment and leaves no copy among the artifact's archives", () =>
    Effect.gen(function* () {
      const artifacts = yield* Artifacts.Service
      const storage = yield* ObjectStorage.Service
      const owner = yield* ArtifactSamples.owner()
      const id = artifactId()
      const deploymentId = deployment()
      yield* ArtifactSamples.deploy(artifacts, owner, id, {
        deploymentId,
        title: "Escaping",
        config: { entry: "index.html" },
        files: { "index.html": text("x"), "../escape.txt": text("y") },
      })
      const refused = yield* settle(artifacts, owner, id, deploymentId)
      const kept = yield* Effect.promise(() =>
        storage.s3.send(
          new ListObjectsV2Command({ Bucket: storage.bucket, Prefix: `${owner.organizationId}/artifacts/${id}/` }),
        ),
      )
      expect([refused.status, kept.KeyCount ?? 0]).toEqual(["failed", 0])
    }).pipe(Effect.provide(ObjectStorage.layer.pipe(Layer.provide(TestDrives.layer)))),
  )

  it.live("a deployment checks its archive in its run, and an archive with no entry fails there with the reason", () =>
    Effect.gen(function* () {
      const artifacts = yield* Artifacts.Service
      const owner = yield* ArtifactSamples.owner()
      const id = artifactId()
      const deploymentId = deployment()
      const upload = yield* artifacts.upload(owner, id)
      const body = yield* Effect.promise(() => ArtifactSamples.archive({ "a.txt": "a", "b.txt": "b" }))
      yield* Effect.promise(() => fetch(upload.url, { method: "PUT", body }))
      const accepted = yield* artifacts.deploy(owner, id, {
        deploymentId,
        uploadId: upload.uploadId,
        title: "No entry",
      })
      expect(accepted.status).toBe("deploying")
      const failed = yield* settle(artifacts, owner, id, deploymentId)
      expect([failed.status, failed.error]).toEqual(["failed", expect.stringContaining("index.html")])
    }),
  )

  it.live(
    "a deployment keeps its status after the engine's rows of its runs are gone",
    () =>
      Effect.gen(function* () {
        const artifacts = yield* Artifacts.Service
        const sql = yield* SqlClient.SqlClient
        const owner = yield* ArtifactSamples.owner()
        const id = artifactId()
        const deploymentId = deployment()
        yield* Effect.addFinalizer(() => stop(artifacts, owner, id).pipe(Effect.ignore))
        yield* ArtifactSamples.deploy(artifacts, owner, id, {
          deploymentId,
          title: "Kept",
          config: { entry: "index.html" },
          files: { "index.html": text("kept") },
        })
        const ready = yield* settle(artifacts, owner, id, deploymentId)
        expect(ready.status).toBe("ready")
        yield* sql`delete from cluster_replies where request_id in (select id from cluster_messages where entity_type like 'Workflow/Artifact%' and payload::jsonb ->> 'id' = ${id})`
        yield* sql`delete from cluster_messages where entity_type like 'Workflow/Artifact%' and payload::jsonb ->> 'id' = ${id}`
        const after = yield* artifacts.status(owner, id, deploymentId)
        expect([after.status, after.url]).toEqual(["ready", ready.url])
      }),
    120_000,
  )

  it.live(
    "a deployment names the version it started from, and Ren refuses a stale one",
    () =>
      Effect.gen(function* () {
        const artifacts = yield* Artifacts.Service
        const database = yield* Database.Service
        const owner = yield* ArtifactSamples.owner()
        const id = artifactId()
        yield* Effect.addFinalizer(() => stop(artifacts, owner, id).pipe(Effect.ignore))
        const input = { title: "Base", config: { entry: "index.html" }, files: { "index.html": text("v1") } }
        const first = deployment()
        yield* ArtifactSamples.deploy(artifacts, owner, id, { ...input, deploymentId: first })
        expect((yield* settle(artifacts, owner, id, first)).status).toBe("ready")
        const broken = deployment()
        yield* ArtifactSamples.deploy(artifacts, owner, id, {
          ...input,
          deploymentId: broken,
          baseDeploymentId: first,
          config: { entry: "missing.html" },
        })
        expect((yield* settle(artifacts, owner, id, broken)).status).toBe("failed")
        const second = deployment()
        yield* ArtifactSamples.deploy(artifacts, owner, id, {
          ...input,
          deploymentId: second,
          baseDeploymentId: broken,
          files: { "index.html": text("v2") },
        })
        expect((yield* settle(artifacts, owner, id, second)).status).toBe("ready")
        const stored = yield* database.db
          .select({ base: Database.Schema.artifact_deployment.base_deployment_id })
          .from(Database.Schema.artifact_deployment)
          .where(eq(Database.Schema.artifact_deployment.id, second))
        expect(stored).toEqual([{ base: first }])
        const stale = yield* ArtifactSamples.deploy(artifacts, owner, id, {
          ...input,
          deploymentId: deployment(),
          baseDeploymentId: first,
        }).pipe(Effect.flip)
        expect([stale._tag, stale.message]).toEqual(["Primitive.Conflict", expect.stringContaining(second)])
      }),
    120_000,
  )

  it.live(
    "a stop that fails for good ends as failed and releases the claim for the next deployment",
    () =>
      Effect.gen(function* () {
        const artifacts = yield* Artifacts.Service
        const database = yield* Database.Service
        const owner = yield* ArtifactSamples.owner()
        const id = artifactId()
        const input = { title: "Stuck", config: { entry: "index.html" }, files: { "index.html": text("v1") } }
        const first = deployment()
        yield* ArtifactSamples.deploy(artifacts, owner, id, { ...input, deploymentId: first })
        expect((yield* settle(artifacts, owner, id, first)).status).toBe("ready")
        const table = Database.Schema.artifact
        const row = (yield* database.db.select().from(table).where(eq(table.id, id))).at(0)
        const remote = yield* Schema.decodeUnknownEffect(Schema.Struct({ directory: Schema.String }))(row?.remote)
        const writable = Effect.promise(() => chmod(remote.directory, 0o755))
        yield* Effect.addFinalizer(() => writable.pipe(Effect.andThen(stop(artifacts, owner, id)), Effect.ignore))
        yield* Effect.promise(() => chmod(remote.directory, 0o555))
        const stopping = yield* artifacts.stop(owner, id)
        yield* idle(id)
        expect((yield* artifacts.status(owner, id, stopping.deploymentId)).status).toBe("failed")
        yield* writable
        expect(
          (yield* ArtifactSamples.deploy(artifacts, owner, id, { ...input, deploymentId: deployment() })).status,
        ).toBe("deploying")
        yield* idle(id)
      }),
    120_000,
  )

  it.live(
    "a defect in a run ends its row as failed and releases the claim",
    () =>
      Effect.gen(function* () {
        const artifacts = yield* Artifacts.Service
        const database = yield* Database.Service
        const owner = yield* ArtifactSamples.owner()
        const id = artifactId()
        const input = { title: "Defect", config: { entry: "index.html" }, files: { "index.html": text("v1") } }
        const first = deployment()
        yield* ArtifactSamples.deploy(artifacts, owner, id, { ...input, deploymentId: first })
        expect((yield* settle(artifacts, owner, id, first)).status).toBe("ready")
        const table = Database.Schema.artifact
        const remote = (yield* database.db.select({ remote: table.remote }).from(table).where(eq(table.id, id))).at(0)
        yield* Effect.addFinalizer(() =>
          database.db
            .update(table)
            .set({ remote: remote?.remote ?? null })
            .where(eq(table.id, id))
            .pipe(Effect.andThen(stop(artifacts, owner, id)), Effect.ignore),
        )
        yield* database.db
          .update(table)
          .set({ remote: { unknown: true } })
          .where(eq(table.id, id))
        const next = deployment()
        yield* ArtifactSamples.deploy(artifacts, owner, id, { ...input, deploymentId: next })
        expect((yield* settle(artifacts, owner, id, next)).status).toBe("failed")
        expect((yield* artifacts.read(owner, id)).pendingDeploymentId).toBeNull()
      }),
    120_000,
  )

  it.live(
    "applies per-object SQL migrations atomically and rejects incompatible old code",
    () =>
      Effect.gen(function* () {
        const artifacts = yield* Artifacts.Service
        const owner = yield* ArtifactSamples.owner()
        const id = artifactId()
        const files = yield* Effect.promise(() => ArtifactSamples.files("state-candidate"))
        const config = { entry: "index.html", durableObjects: { STATE: "SampleState" } }
        const publish = (files: Artifact.Files) =>
          Effect.gen(function* () {
            const attempt = deployment()
            yield* ArtifactSamples.deploy(artifacts, owner, id, {
              title: "SQL migrations",
              deploymentId: attempt,
              config,
              files,
            })
            return yield* settle(artifacts, owner, id, attempt)
          })
        yield* Effect.addFinalizer(() => stop(artifacts, owner, id).pipe(Effect.ignore))
        const ready = yield* publish(files)
        expect(ready.status).toBe("ready")
        const origin = new URL(ready.url ?? "").origin
        yield* ArtifactSamples.schemaUpgrade({
          publish,
          files,
          origin,
          restart: (files) =>
            stop(artifacts, owner, id).pipe(
              Effect.andThen(publish(files)),
              Effect.map((result) => new URL(result.url ?? "").origin),
            ),
        })
      }),
    180_000,
  )
  it.live(
    "publishes the report with its binary assets and the server-code dashboard through Ren",
    () =>
      Effect.gen(function* () {
        const artifacts = yield* Artifacts.Service
        const owner = yield* ArtifactSamples.owner()
        const id = artifactId()
        yield* Effect.addFinalizer(() => stop(artifacts, owner, id).pipe(Effect.ignore))
        const samples = yield* Effect.promise(() => ArtifactSamples.files("dashboard"))
        const chart = crypto.getRandomValues(new Uint8Array(6 * 1024 * 1024))
        const report = deployment()
        yield* ArtifactSamples.deploy(artifacts, owner, id, {
          title: "Report",
          deploymentId: report,
          config: { entry: "report.html" },
          files: {
            ...Object.fromEntries(Object.entries(samples).filter(([path]) => path !== "_worker.js")),
            "assets/chart.png": chart,
          },
        })
        const reportReady = yield* settle(artifacts, owner, id, report)
        expect(reportReady.status).toBe("ready")
        expect((yield* read(reportReady.url ?? "")).body).toContain("Quarterly operating report")
        const served = yield* Effect.promise(() =>
          fetch(`${new URL(reportReady.url ?? "").origin}/assets/chart.png`).then((response) => response.bytes()),
        )
        expect(served).toEqual(chart)
        const attempt = deployment()
        yield* ArtifactSamples.deploy(artifacts, owner, id, {
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
        const owner = yield* ArtifactSamples.owner()
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
            yield* ArtifactSamples.deploy(artifacts, owner, id, { ...input, files, deploymentId: attempt })
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
        yield* ArtifactSamples.deploy(artifacts, owner, id, {
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
        yield* ArtifactSamples.deploy(artifacts, owner, id, {
          ...input,
          config: { entry: "index.html" },
          deploymentId: removed,
        })
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
        const owner = yield* ArtifactSamples.owner()
        const id = artifactId()
        const deploymentId = deployment()
        const messages = () =>
          sql<{
            readonly entity_type: string
          }>`select entity_type from cluster_messages where entity_type = 'Workflow/ArtifactDeploy' and payload::jsonb ->> 'id' = ${id}`
        yield* database
          .transaction(() =>
            Effect.gen(function* () {
              yield* ArtifactSamples.deploy(artifacts, owner, id, {
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
    "stop returns while a deployment holds, takes the claim at once, and ends the deployment as stopped",
    () =>
      Effect.gen(function* () {
        const artifacts = yield* Artifacts.Service
        const database = yield* Database.Service
        const sql = yield* SqlClient.SqlClient
        const owner = yield* ArtifactSamples.owner()
        const id = artifactId()
        const deploymentId = deployment()
        const hold = yield* held
        yield* Effect.addFinalizer(() => stop(artifacts, owner, id).pipe(Effect.ignore))
        const input = { deploymentId, title: "Pending", config: { entry: "_worker.js" }, files: hold.files }
        expect((yield* ArtifactSamples.deploy(artifacts, owner, id, input)).status).toBe("deploying")
        yield* hold.entered
        expect(yield* ArtifactSamples.deploy(artifacts, owner, id, input)).toMatchObject({
          deploymentId,
          status: "deploying",
        })
        const rows = yield* database.db
          .select()
          .from(Database.Schema.artifact_deployment)
          .where(eq(Database.Schema.artifact_deployment.artifact_id, id))
        const runs =
          yield* sql`select id from cluster_messages where entity_type = 'Workflow/ArtifactDeploy' and payload::jsonb ->> 'deploymentId' = ${deploymentId}`
        expect([rows.length, runs.length]).toEqual([1, 1])
        const stopping = yield* artifacts.stop(owner, id)
        expect(stopping.status).toBe("stopping")
        expect((yield* artifacts.stop(owner, id)).deploymentId).toBe(stopping.deploymentId)
        expect(
          (yield* ArtifactSamples.deploy(artifacts, owner, id, { ...input, deploymentId: deployment() }).pipe(
            Effect.flip,
          ))._tag,
        ).toBe("Primitive.Conflict")
        yield* hold.release
        yield* idle(id)
        expect((yield* artifacts.status(owner, id, stopping.deploymentId)).status).toBe("stopped")
        expect((yield* artifacts.status(owner, id, deploymentId)).status).toBe("stopped")
        expect(yield* artifacts.read(owner, id)).toMatchObject({
          url: null,
          pendingDeploymentId: null,
          publishedDeploymentId: null,
        })
        expect((yield* artifacts.download(owner, id).pipe(Effect.flip))._tag).toBe("Primitive.NotFound")
      }),
    120_000,
  )

  it.live(
    "retains successful source, config and serving app on failure, and stops only the deployment",
    () =>
      Effect.gen(function* () {
        const artifacts = yield* Artifacts.Service
        const database = yield* Database.Service
        const owner = yield* ArtifactSamples.owner()
        const id = artifactId()
        const first = {
          deploymentId: deployment(),
          title: "Report",
          config: { entry: "index.html" },
          files: { "index.html": text("<h1>v1</h1>") },
        }
        let latest = first.deploymentId
        yield* Effect.addFinalizer(() => stop(artifacts, owner, id).pipe(Effect.ignore))
        yield* ArtifactSamples.deploy(artifacts, owner, id, first)
        const ready = yield* settle(artifacts, owner, id, first.deploymentId)
        expect(ready.status).toBe("ready")
        const url = yield* Schema.decodeUnknownEffect(Schema.String)(ready.url)
        expect((yield* read(url)).body).toBe("<h1>v1</h1>")
        const elsewhere = yield* ArtifactSamples.owner()
        expect((yield* artifacts.status(elsewhere, id, first.deploymentId).pipe(Effect.flip))._tag).toBe(
          "Primitive.NotFound",
        )
        expect((yield* artifacts.read(elsewhere, id).pipe(Effect.flip))._tag).toBe("Primitive.NotFound")
        expect((yield* artifacts.download(elsewhere, id).pipe(Effect.flip))._tag).toBe("Primitive.NotFound")
        expect((yield* artifacts.upload(elsewhere, id).pipe(Effect.flip))._tag).toBe("Primitive.NotFound")
        expect(
          (yield* artifacts
            .deploy(elsewhere, id, {
              deploymentId: deployment(),
              uploadId: Artifact.UploadID.make(crypto.randomUUID()),
            })
            .pipe(Effect.flip))._tag,
        ).toBe("Primitive.NotFound")
        expect(
          (yield* artifacts
            .deploy(elsewhere, Artifact.ID.make(`art_${Identifier.suffix(id).toUpperCase()}`), {
              deploymentId: deployment(),
              title: "Same label",
              uploadId: Artifact.UploadID.make(crypto.randomUUID()),
            })
            .pipe(Effect.flip))._tag,
        ).toBe("Primitive.NotFound")
        expect((yield* artifacts.status(owner, id, deployment()).pipe(Effect.flip))._tag).toBe("Primitive.NotFound")
        const before = (yield* database.db
          .select()
          .from(Database.Schema.artifact)
          .where(eq(Database.Schema.artifact.id, id))).at(0)
        const binding = yield* Schema.decodeUnknownEffect(Schema.Struct({ directory: Schema.String }))(before?.remote)
        yield* Effect.promise(() => Bun.write(join(binding.directory, "state", "keep.txt"), "application data"))
        latest = deployment()
        yield* ArtifactSamples.deploy(artifacts, owner, id, {
          deploymentId: latest,
          title: "Broken",
          config: { entry: "other.html" },
          files: { "other.html": text("bad"), "_worker.js": text("export default {") },
        })
        const failed = yield* settle(artifacts, owner, id, latest)
        expect(failed.status).toBe("failed")
        expect(failed.error).toContain("did not serve")
        expect((yield* read(url)).body).toBe("<h1>v1</h1>")
        expect(yield* ArtifactSamples.published(artifacts, owner, id)).toEqual(first.files)
        const after = (yield* database.db
          .select()
          .from(Database.Schema.artifact)
          .where(eq(Database.Schema.artifact.id, id))).at(0)
        expect(after?.code_archive).toBe(before?.code_archive)
        expect(after?.config).toEqual(first.config)
        expect(yield* artifacts.read(owner, id)).toMatchObject({ title: first.title, entry: "index.html", url })
        yield* stop(artifacts, owner, id)
        expect(yield* ArtifactSamples.published(artifacts, owner, id)).toEqual(first.files)
        expect(yield* Effect.promise(() => Bun.file(join(binding.directory, "state", "keep.txt")).text())).toBe(
          "application data",
        )
        expect(yield* Effect.promise(() => Bun.file(join(binding.directory, "serving.json")).exists())).toBe(false)
        const stopped = (yield* database.db
          .select()
          .from(Database.Schema.artifact)
          .where(eq(Database.Schema.artifact.id, id))).at(0)
        expect(stopped?.remote).toEqual(before?.remote)
        expect(stopped?.url).toBeNull()
        expect(yield* read(url).pipe(Effect.isFailure)).toBe(true)
        latest = deployment()
        yield* ArtifactSamples.deploy(artifacts, owner, id, { ...first, deploymentId: latest })
        const resumed = yield* settle(artifacts, owner, id, latest)
        expect([resumed.status, resumed.url]).toEqual(["ready", url])
        expect((yield* read(resumed.url ?? "")).body).toBe("<h1>v1</h1>")
        yield* stop(artifacts, owner, id)
        expect(yield* read(resumed.url ?? "").pipe(Effect.isFailure)).toBe(true)
      }),
    120_000,
  )

  recovery.live(
    "a result whose send fails with BrainUnavailable reaches the chat once, after a retry, under one message id",
    () =>
      Effect.gen(function* () {
        const sends: Array<{ readonly messageId: unknown; readonly status: number }> = []
        const refused = Promise.withResolvers<void>()
        const brain = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch: async (request) => {
            const body: unknown = await request.json().catch(() => null)
            const messageId = Predicate.hasProperty(body, "messageId") ? body.messageId : undefined
            if (messageId === undefined) return new Response(null, { status: 404 })
            const status = sends.filter((send) => send.status === 503).length < 5 ? 503 : 200
            sends.push({ messageId, status })
            if (sends.length === 5) refused.resolve()
            return status === 200 ? Response.json({ messageId }) : new Response(null, { status })
          },
        })
        yield* Effect.addFinalizer(() => Effect.promise(() => brain.stop(true)))
        const owner = yield* ArtifactSamples.owner()
        const sessionId = yield* Seed.session(owner)
        const id = artifactId()
        const deploymentId = deployment()
        yield* Effect.gen(function* () {
          const artifacts = yield* Artifacts.Service
          yield* Effect.addFinalizer(() => stop(artifacts, owner, id).pipe(Effect.ignore))
          yield* ArtifactSamples.deploy(artifacts, owner, id, {
            deploymentId,
            sessionId,
            title: "Told",
            config: { entry: "index.html" },
            files: { "index.html": text("told") },
          })
          yield* Effect.promise(() => refused.promise)
          yield* idle(id)
        }).pipe(Effect.scoped, Effect.provide(Layer.fresh(runtimeWith(brain.url.origin))))
        expect(new Set(sends.map((send) => send.messageId))).toEqual(
          new Set([`msg_${deploymentId.replaceAll("-", "")}`]),
        )
        expect(sends.map((send) => send.status)).toEqual([503, 503, 503, 503, 503, 200])
      }),
    120_000,
  )

  recovery.live("a deployment whose runtime cannot start fails, and Ren keeps running", () =>
    Effect.gen(function* () {
      const owner = yield* ArtifactSamples.owner()
      const id = artifactId()
      const deploymentId = deployment()
      const missing = ConfigProvider.layerAdd(ConfigProvider.fromUnknown({ ARTIFACT_NODE: "/nonexistent/node" }), {
        asPrimary: true,
      })
      const failed = yield* Effect.gen(function* () {
        const artifacts = yield* Artifacts.Service
        yield* ArtifactSamples.deploy(artifacts, owner, id, {
          deploymentId,
          title: "No runtime",
          config: { entry: "index.html" },
          files: { "index.html": text("unserved") },
        })
        return yield* settle(artifacts, owner, id, deploymentId)
      }).pipe(Effect.scoped, Effect.provide(Layer.fresh(runtime.pipe(Layer.provide(missing)))))
      expect([failed.status, failed.error]).toEqual(["failed", expect.stringContaining("wrangler did not start")])
    }),
  )

  recovery.live(
    "recovers the durable input after the runner exits during deployment",
    () =>
      Effect.gen(function* () {
        const owner = yield* ArtifactSamples.owner()
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
          yield* ArtifactSamples.deploy(artifacts, owner, id, {
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

const page = { page: 1, pageSize: 50 }

const orders = { "index.html": text("<h1>Orders</h1>") }

const deploy = (owner: Artifacts.Owner, id: Artifact.ID) =>
  Effect.flatMap(Artifacts.Service, (artifacts) =>
    ArtifactSamples.deploy(artifacts, owner, id, {
      deploymentId: deployment(),
      title: "Orders",
      config: { entry: "index.html" },
      files: orders,
    }).pipe(Effect.andThen(idle(id))),
  )

const memberOf = (owner: Effect.Success<ReturnType<typeof Seed.owner>>) => ({
  userId: owner.createdBy,
  organizationId: owner.organizationId,
  roles: ["member"],
})

describe("artifacts for people", () => {
  named.live(
    "a new artifact gets a free name from its title; a taken name is a conflict; archive frees the name",
    () =>
      Effect.gen(function* () {
        const artifacts = yield* Artifacts.Service
        const owner = yield* ArtifactSamples.owner()
        const title = `Menu ${crypto.randomUUID().slice(0, 8)}`
        const base = Artifact.nameOf(title) ?? ""
        const publish = (id: Artifact.ID) =>
          ArtifactSamples.deploy(artifacts, owner, id, {
            deploymentId: deployment(),
            title,
            config: { entry: "index.html" },
            files: orders,
          }).pipe(Effect.andThen(idle(id)))
        const first = artifactId()
        const second = artifactId()
        yield* publish(first)
        yield* publish(second)
        const member = memberOf(owner)
        expect([(yield* artifacts.get(member, first)).name, (yield* artifacts.get(member, second)).name]).toEqual([
          base,
          `${base}-2`,
        ])
        expect((yield* artifacts.update(member, second, { name: base }).pipe(Effect.flip))._tag).toBe(
          "Primitive.Conflict",
        )
        yield* artifacts.archive(member, first)
        yield* idle(first)
        expect((yield* artifacts.update(member, second, { name: base })).name).toBe(base)
        expect(yield* artifacts.update(member, second, { title: "Lunch menu" })).toMatchObject({
          title: "Lunch menu",
          name: base,
        })
        yield* stop(artifacts, owner, second)
      }),
    60_000,
  )

  named.live(
    "a late write of a freed name does not undo its new owner",
    () =>
      Effect.gen(function* () {
        const artifacts = yield* Artifacts.Service
        const owner = yield* ArtifactSamples.owner()
        const member = memberOf(owner)
        const suffix = crypto.randomUUID().slice(0, 8)
        const publish = (id: Artifact.ID, title: string) =>
          ArtifactSamples.deploy(artifacts, owner, id, {
            deploymentId: deployment(),
            title,
            config: { entry: "index.html" },
            files: orders,
          }).pipe(Effect.andThen(idle(id)))
        const first = artifactId()
        const second = artifactId()
        yield* publish(first, `Shop ${suffix}`)
        yield* publish(second, `Other ${suffix}`)
        const name = Artifact.nameOf(`Shop ${suffix}`) ?? ""
        yield* DurableRunner.join(Artifacts.NameRun, { name, epoch: 1 })
        expect(names.get(name)).toBe(Artifact.label(first))
        const hold = { entered: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() }
        removes.hold = hold
        yield* artifacts.update(member, first, { name: `moved-${suffix}` })
        yield* Effect.promise(() => hold.entered.promise)
        yield* artifacts.update(member, second, { name })
        yield* DurableRunner.join(Artifacts.NameRun, { name, epoch: 3 })
        expect(names.get(name)).toBe(Artifact.label(second))
        hold.release.resolve()
        yield* DurableRunner.join(Artifacts.NameRun, { name, epoch: 2 })
        expect([names.get(name), names.get(`moved-${suffix}`)]).toEqual([Artifact.label(second), Artifact.label(first)])
        yield* stop(artifacts, owner, first)
        yield* stop(artifacts, owner, second)
      }),
    60_000,
  )

  it.live("members list a space's artifacts newest first and get each; a member of another space sees none", () =>
    Effect.gen(function* () {
      const artifacts = yield* Artifacts.Service
      const owner = yield* ArtifactSamples.owner()
      const older = artifactId()
      const newer = artifactId()
      yield* deploy(owner, older)
      yield* stop(artifacts, owner, older)
      yield* deploy(owner, newer)
      yield* stop(artifacts, owner, newer)
      const member = memberOf(owner)
      const listed = yield* artifacts.list(member, { spaceId: owner.spaceId, ...page })
      expect([listed.items.map((item) => item.id), listed.total]).toEqual([[newer, older], 2])
      expect(yield* artifacts.get(member, newer)).toMatchObject({
        id: newer,
        spaceId: owner.spaceId,
        title: "Orders",
        entry: "index.html",
        archivedAt: null,
      })
      const outsider = yield* Seed.actor(owner.organizationId, "owner")
      yield* Seed.join(yield* Seed.space(owner.organizationId), outsider.userId)
      expect((yield* artifacts.list(outsider, page)).total).toBe(0)
      expect((yield* artifacts.get(outsider, newer).pipe(Effect.flip))._tag).toBe("Primitive.NotFound")
      expect((yield* artifacts.archive(outsider, newer).pipe(Effect.flip))._tag).toBe("Primitive.NotFound")
    }),
  )

  it.live(
    "archive returns while a deployment holds, and the stop it starts takes the artifact down",
    () =>
      Effect.gen(function* () {
        const artifacts = yield* Artifacts.Service
        const owner = yield* ArtifactSamples.owner()
        const id = artifactId()
        const hold = yield* held
        yield* Effect.addFinalizer(() => stop(artifacts, owner, id).pipe(Effect.ignore))
        yield* ArtifactSamples.deploy(artifacts, owner, id, {
          deploymentId: deployment(),
          title: "Held",
          config: { entry: "_worker.js" },
          files: hold.files,
        })
        yield* hold.entered
        const archived = yield* artifacts.archive(memberOf(owner), id)
        expect(archived.archivedAt).not.toBeNull()
        const stopId = yield* Schema.decodeUnknownEffect(Artifact.DeploymentID)(archived.pendingDeploymentId)
        yield* hold.release
        yield* idle(id)
        expect((yield* artifacts.status(owner, id, stopId)).status).toBe("stopped")
        expect((yield* artifacts.read(owner, id)).url).toBeNull()
      }),
    120_000,
  )

  it.live(
    "archiving takes the artifact down and out of the list, refuses new deployments but answers a retried one, and keeps its source",
    () =>
      Effect.gen(function* () {
        const artifacts = yield* Artifacts.Service
        const database = yield* Database.Service
        const owner = yield* ArtifactSamples.owner()
        const member = memberOf(owner)
        const id = artifactId()
        const upload = yield* artifacts.upload(owner, id)
        const body = yield* Effect.promise(() => ArtifactSamples.archive(orders))
        yield* Effect.promise(() => fetch(upload.url, { method: "PUT", body }))
        const first = {
          deploymentId: Artifact.DeploymentID.make(crypto.randomUUID()),
          uploadId: upload.uploadId,
          title: "Orders",
        }
        yield* artifacts.deploy(owner, id, first)
        yield* idle(id)
        const archived = yield* artifacts.archive(member, id)
        expect(archived.archivedAt).not.toBeNull()
        yield* idle(id)
        const row = (yield* database.db
          .select()
          .from(Database.Schema.artifact)
          .where(eq(Database.Schema.artifact.id, id))).at(0)
        expect([row?.url, row?.pending_deployment_id]).toEqual([null, null])
        expect((yield* artifacts.list(member, { spaceId: owner.spaceId, ...page })).total).toBe(0)
        expect((yield* artifacts.get(member, id).pipe(Effect.flip))._tag).toBe("Primitive.NotFound")
        expect((yield* artifacts.archive(member, id).pipe(Effect.flip))._tag).toBe("Primitive.NotFound")
        expect((yield* artifacts.upload(owner, id).pipe(Effect.flip))._tag).toBe("Primitive.Conflict")
        expect(
          (yield* artifacts
            .deploy(owner, id, {
              deploymentId: Artifact.DeploymentID.make(crypto.randomUUID()),
              uploadId: Artifact.UploadID.make(crypto.randomUUID()),
            })
            .pipe(Effect.flip))._tag,
        ).toBe("Primitive.Conflict")
        expect((yield* artifacts.deploy(owner, id, first)).deploymentId).toBe(first.deploymentId)
        expect(yield* ArtifactSamples.published(artifacts, owner, id)).toEqual(orders)
      }),
  )
})
