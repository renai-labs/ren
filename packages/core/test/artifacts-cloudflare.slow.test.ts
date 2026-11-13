import { describe, expect, setDefaultTimeout } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Artifact } from "@ren/schema/artifact"
import { eq } from "drizzle-orm"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { Deferred, Effect, Fiber, Layer, Option, Schedule } from "effect"
import { ArtifactCloudflare } from "../src/artifact-provider/cloudflare.js"
import { Access } from "../src/access.js"
import { Artifacts } from "../src/artifacts.js"
import { ArtifactProvider } from "../src/artifact-provider.js"
import { DurableRunner } from "../src/durable-runner.js"
import { ObjectStorage } from "../src/object-storage.js"
import { ArtifactSamples } from "./lib/artifact-samples.js"
import { TestDrives } from "./lib/drives.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"
import { TestCloudflare } from "./lib/cloudflare.js"
import { Config, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { join } from "node:path"
import { tmpdir } from "node:os"

setDefaultTimeout(600_000)

const it = testEffect(
  Artifacts.layer.pipe(
    Layer.provide([ArtifactCloudflare.layer, Access.layer]),
    Layer.provideMerge(DurableRunner.layerEffect),
    Layer.provide(TestDrives.layer),
    Layer.provideMerge(Layer.mergeAll(Testing.layer, TestCloudflare.layer)),
  ),
)
const text = (value: string) => new TextEncoder().encode(value)
const cutoff = testEffect(
  ObjectStorage.layer.pipe(
    Layer.provide(TestDrives.layer),
    Layer.provideMerge(Layer.mergeAll(Testing.layer, TestCloudflare.layer)),
  ),
)

describe.skipIf(process.env.REN_ARTIFACT_CLOUDFLARE_LIVE !== "1")(
  "real Cloudflare through Ren's durable Artifact workflows",
  () => {
    it.live("migrates application SQLite on object initialization across update and redeploy", () =>
      Effect.gen(function* () {
        const artifacts = yield* Artifacts.Service
        const owner = yield* Seed.owner()
        const id = Artifact.ID.make(`art_${crypto.randomUUID().replaceAll("-", "")}`)
        const config = { entry: "index.html", durableObjects: { STATE: "SampleState" } }
        const publish = (files: Artifact.Files) =>
          Effect.gen(function* () {
            const deploymentId = Artifact.DeploymentID.make(crypto.randomUUID())
            yield* ArtifactSamples.deploy(artifacts, owner, id, {
              deploymentId,
              title: "SQL migration smoke",
              config,
              files,
            })
            yield* ArtifactSamples.idle(id)
            return yield* artifacts.status(owner, id, deploymentId)
          })
        yield* Effect.addFinalizer(() =>
          artifacts.stop(owner, id).pipe(Effect.andThen(ArtifactSamples.idle(id)), Effect.ignore),
        )
        const files = yield* Effect.promise(() => ArtifactSamples.files("state-candidate"))
        const first = yield* publish(files)
        expect(first.status).toBe("ready")
        const origin = new URL(first.url ?? "").origin
        yield* ArtifactSamples.schemaUpgrade({
          files,
          origin,
          publish,
          restart: (files) =>
            artifacts.stop(owner, id).pipe(
              Effect.andThen(ArtifactSamples.idle(id)),
              Effect.andThen(publish(files)),
              Effect.map((result) => new URL(result.url ?? "").origin),
            ),
        })
      }),
    )
    testEffect(TestCloudflare.layer).live(
      "legacy SQLite classes transition to exports and reject a stale ETag",
      () =>
        Effect.gen(function* () {
          const account = yield* Config.String("CLOUDFLARE_ACCOUNT_ID")
          const token = yield* Config.Redacted("CLOUDFLARE_API_TOKEN")
          const script = `ren-artifact-smoke-etag-${crypto.randomUUID().slice(0, 8)}`
          const put = (input: {
            readonly metadata: Readonly<Record<string, unknown>>
            readonly body: string
            readonly guard: Option.Option<string>
          }) =>
            ArtifactCloudflare.putScript({
              account,
              token,
              script,
              metadata: { main_module: "main.js", compatibility_date: "2026-06-01", ...input.metadata },
              modules: {
                "main.js": `import {DurableObject} from "cloudflare:workers"; export class Guard extends DurableObject {} export default {fetch(){return new Response("${input.body}",{status:410})}}`,
              },
              guard: input.guard,
            })
          const first = yield* put({
            metadata: { migrations: { new_tag: "legacy-v1", new_sqlite_classes: ["Guard"] } },
            body: "first",
            guard: Option.none(),
          })
          const exports = { exports: { Guard: { type: "durable-object", storage: "sqlite" } } }
          const second = yield* put({ metadata: exports, body: "second", guard: Option.some(JSON.stringify(first)) })
          expect(second).not.toBe(first)
          const stale = yield* put({
            metadata: exports,
            body: "stale",
            guard: Option.some(JSON.stringify(first)),
          }).pipe(Effect.result)
          expect(stale).toMatchObject({ _tag: "Failure" })
          if (stale._tag === "Failure")
            expect([stale.failure.message, stale.failure.retryable]).toEqual([
              expect.stringContaining("HTTP 412"),
              true,
            ])
          const http = yield* HttpClient.HttpClient
          const response = yield* http.execute(
            HttpClientRequest.get(
              `https://api.cloudflare.com/client/v4/accounts/${account}/workers/services/${script}`,
            ).pipe(HttpClientRequest.bearerToken(token)),
          )
          const current = yield* response.json.pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(
                Schema.Struct({
                  result: Schema.Struct({
                    default_environment: Schema.Struct({ script: Schema.Struct({ etag: Schema.String }) }),
                  }),
                }),
              ),
            ),
          )
          expect(current.result.default_environment.script.etag).toBe(second)
          yield* Effect.log(`Declarative ETag smoke retained: ${script}; no workers.dev route enabled`)
        }),
      120_000,
    )
    cutoff.live("a deployment cut off after its write-ahead save is repaired by a fresh provider from that state", () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const storage = yield* ObjectStorage.Service
        const owner = yield* Seed.owner()
        const id = Artifact.ID.make(`art_${crypto.randomUUID().replaceAll("-", "")}`)
        yield* database.db.insert(Database.Schema.artifact).values({
          id,
          organization_id: owner.organizationId,
          space_id: owner.spaceId,
          title: "Cut off",
          provider: ArtifactCloudflare.id,
        })
        const archive = `${owner.organizationId}/artifacts/${id}/source.tar.gz`
        const body = yield* Effect.promise(() => ArtifactSamples.archive({ "index.html": "source kept after the cut" }))
        yield* Effect.promise(() =>
          storage.s3.send(new PutObjectCommand({ Bucket: storage.bucket, Key: archive, Body: body })),
        )
        const saved = Effect.gen(function* () {
          const artifact = (yield* database.db
            .select()
            .from(Database.Schema.artifact)
            .where(eq(Database.Schema.artifact.id, id))).at(0)
          const store = yield* Artifacts.remoteStore(database, id, artifact?.remote_version ?? 0)
          return { remote: Option.fromNullishOr(artifact?.remote), save: store.save }
        })
        const fresh = ArtifactCloudflare.layer.pipe(
          Layer.fresh,
          Layer.provide(TestDrives.layer),
          Layer.provide(TestCloudflare.layer),
        )
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            const provider = yield* ArtifactProvider.Service
            const state = yield* saved
            yield* provider.stop(id, state.remote, state.save)
          }).pipe(Effect.provide(fresh), Effect.ignore),
        )
        const written = yield* Deferred.make<void>()
        yield* Effect.gen(function* () {
          const provider = yield* ArtifactProvider.Service
          const state = yield* saved
          const cut = yield* provider
            .deploy({
              artifactId: id,
              deploymentId: Artifact.DeploymentID.make(crypto.randomUUID()),
              archive,
              config: { entry: "index.html" },
              remote: state.remote,
              save: (remote) => state.save(remote).pipe(Effect.andThen(Deferred.succeed(written, undefined))),
            })
            .pipe(Effect.forkScoped)
          yield* Deferred.await(written)
          yield* Fiber.interrupt(cut)
        }).pipe(Effect.scoped, Effect.provide(fresh))
        const pending = yield* saved
        expect(Option.getOrNull(pending.remote)).toMatchObject({ pending: { ready: false } })
        const restored = yield* Effect.gen(function* () {
          const provider = yield* ArtifactProvider.Service
          return yield* provider.deploy({
            artifactId: id,
            deploymentId: Artifact.DeploymentID.make(crypto.randomUUID()),
            archive,
            config: { entry: "index.html" },
            ...(yield* saved),
          })
        }).pipe(Effect.provide(fresh))
        expect(yield* Effect.promise(() => fetch(restored.url).then((response) => response.text()))).toBe(
          "source kept after the cut",
        )
      }),
    )
    it.live("serves the four sample flows, recovers failed uploads, and retains SQLite over update/stop/redeploy", () =>
      Effect.gen(function* () {
        const artifacts = yield* Artifacts.Service
        const database = yield* Database.Service
        const owner = yield* Seed.owner()
        const id = Artifact.ID.make(`art_${crypto.randomUUID().replaceAll("-", "")}`)
        const idle = ArtifactSamples.idle(id)
        const publish = Effect.fnUntraced(function* (files: Artifact.Files, config: Artifact.Config) {
          const deploymentId = Artifact.DeploymentID.make(crypto.randomUUID())
          expect(
            (yield* ArtifactSamples.deploy(artifacts, owner, id, {
              deploymentId,
              title: "Cloudflare live sample",
              config,
              files,
            })).status,
          ).toBe("deploying")
          yield* idle
          return yield* artifacts.status(owner, id, deploymentId)
        })
        yield* Effect.addFinalizer(() =>
          artifacts.stop(owner, id).pipe(Effect.andThen(ArtifactSamples.idle(id)), Effect.ignore),
        )
        const dashboard = yield* Effect.promise(() => ArtifactSamples.files("dashboard"))
        const report = yield* publish(
          Object.fromEntries(Object.entries(dashboard).filter(([path]) => path !== "_worker.js")),
          { entry: "report.html" },
        )
        expect(report.status).toBe("ready")
        const url = report.url ?? ""
        const origin = new URL(url).origin
        const reportProof = yield* Effect.promise(() =>
          fetch(origin, { headers: { "x-ren-artifact-probe": "1" } }).then((response) => response.text()),
        )
        expect(reportProof).toMatch(new RegExp(`^${report.deploymentId}:[0-9a-f-]{36}$`, "u"))
        yield* Effect.log(`Ren Cloudflare live artifact retained: ${id} ${url}`)
        expect(yield* Effect.promise(() => fetch(url).then((response) => response.text()))).toContain(
          "Quarterly operating report",
        )
        const dynamic = yield* publish(dashboard, { entry: "index.html" })
        expect(dynamic.status).toBe("ready")
        expect(new URL(dynamic.url ?? "").origin).toBe(origin)
        yield* ArtifactSamples.pages(origin)

        const state = yield* Effect.promise(() => ArtifactSamples.files("state-candidate"))
        const config = { entry: "index.html", durableObjects: { STATE: "SampleState" } }
        expect((yield* publish(state, config)).status).toBe("ready")
        yield* ArtifactSamples.guestbook(origin)
        const source = new TextDecoder().decode(state["_worker.js"])
        const updated = { ...state, "_worker.js": text(source.replace('"1" : SAMPLE_VERSION', '"2" : SAMPLE_VERSION')) }
        const update = yield* publish(updated, config)
        expect(update.status).toBe("ready")
        const saved = (yield* database.db
          .select()
          .from(Database.Schema.artifact)
          .where(eq(Database.Schema.artifact.id, id))).at(0)
        const replay = yield* Effect.gen(function* () {
          const provider = yield* ArtifactProvider.Service
          return yield* provider.deploy({
            artifactId: id,
            deploymentId: update.deploymentId,
            archive: saved?.code_archive ?? "",
            config,
            remote: Option.fromNullishOr(saved?.remote),
            save: () => Effect.void,
          })
        }).pipe(
          Effect.provide(
            ArtifactCloudflare.layer.pipe(
              Layer.fresh,
              Layer.provide(TestCloudflare.layer),
              Layer.provide(TestDrives.layer),
            ),
          ),
        )
        expect(replay.url).toBe(update.url ?? "")
        yield* ArtifactSamples.retained(origin, "2")
        const beforeFailureProof = yield* Effect.promise(() =>
          fetch(origin, { headers: { "x-ren-artifact-probe": "1" } }).then((response) => response.text()),
        )
        const failed = yield* publish({ ...state, "_worker.js": text("export default {") }, config)
        expect(failed.status).toBe("failed")
        expect(
          yield* Effect.promise(() =>
            fetch(origin, { headers: { "x-ren-artifact-probe": "1" } }).then((response) => response.text()),
          ),
        ).not.toBe(beforeFailureProof)
        expect(
          yield* Effect.promise(() => fetch(`${origin}/api/entries`).then((response) => response.text())),
        ).toContain("Persistent")
        const privateModule = join(tmpdir(), "opencode", `artifact-host-only-${crypto.randomUUID()}.js`)
        yield* Effect.promise(() => Bun.write(privateModule, 'export default "host-only-sentinel"'))
        yield* Effect.addFinalizer(() => Effect.promise(() => Bun.file(privateModule).delete()).pipe(Effect.ignore))
        const hostImport = `import hostOnly from ${JSON.stringify(privateModule)};\n${new TextDecoder().decode(updated["_worker.js"]).replaceAll("const path = new URL(request.url).pathname", 'const path = new URL(request.url).pathname; if (path === "/private") return new Response(hostOnly)')}`
        expect((yield* publish({ ...updated, "_worker.js": text(hostImport) }, config)).status).toBe("failed")
        expect(
          (yield* publish(state, { entry: "index.html", durableObjects: { RENAMED: "SampleState" } })).status,
        ).toBe("failed")
        yield* artifacts.stop(owner, id)
        yield* idle
        yield* Effect.promise(() => fetch(origin).then((response) => response.status === 410)).pipe(
          Effect.repeat({ schedule: Schedule.spaced("1 second"), until: Boolean }),
          Effect.timeout("45 seconds"),
        )
        const resumed = yield* publish(updated, config)
        expect(resumed).toMatchObject({ status: "ready", error: null })
        yield* ArtifactSamples.retained(origin, "2")
        yield* ArtifactSamples.edit(origin)
        const extraSource = `${new TextDecoder().decode(updated["_worker.js"]).replace('if (path.startsWith("/api/") || path === "/room")', 'if (path === "/recovery") return env.EXTRA.get(env.EXTRA.idFromName("retained")).fetch(request); if (path.startsWith("/api/") || path === "/room")')}
export class RecoveryState extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.sql = ctx.storage.sql; this.sql.exec("CREATE TABLE IF NOT EXISTS recovery (value TEXT)"); }
  async fetch(request) {
    if (request.method === "PUT") this.sql.exec("INSERT INTO recovery (value) VALUES (?)", await request.text());
    return Response.json(this.sql.exec("SELECT value FROM recovery").toArray());
  }
}`
        const extraConfig = { entry: "index.html", durableObjects: { STATE: "SampleState", EXTRA: "RecoveryState" } }
        const failedReadiness = Artifact.DeploymentID.make(crypto.randomUUID())
        yield* ArtifactSamples.deploy(artifacts, owner, id, {
          deploymentId: failedReadiness,
          title: "Failed class addition",
          config: extraConfig,
          files: {
            ...updated,
            "_worker.js": text(`${extraSource}
const NativeResponse = Response;
globalThis.Response = class extends NativeResponse {
  constructor(body, init) { super(typeof body === "string" && /^[0-9a-f-]{36}(?::[0-9a-f-]+)?$/.test(body) ? "probe blocked" : body, init); }
};`),
          },
        })
        yield* Effect.promise(() =>
          fetch(`${origin}/recovery`, { method: "PUT", body: "Kept from failed deployment" }).then(
            (response) => response.status === 200,
          ),
        ).pipe(Effect.repeat({ schedule: Schedule.spaced("1 second"), until: Boolean }), Effect.timeout("40 seconds"))
        expect(
          yield* Effect.promise(() =>
            fetch(origin, { headers: { "x-ren-artifact-probe": "1" } }).then((response) => response.text()),
          ),
        ).toBe("probe blocked")
        yield* idle
        expect((yield* artifacts.status(owner, id, failedReadiness)).status).toBe("failed")
        expect((yield* Effect.promise(() => fetch(`${origin}/api/messages`))).status).toBe(200)
        expect((yield* publish({ ...updated, "_worker.js": text(extraSource) }, extraConfig)).status).toBe("ready")
        expect(yield* Effect.promise(() => fetch(`${origin}/recovery`).then((response) => response.text()))).toContain(
          "Kept from failed deployment",
        )
      }),
    )
  },
)
