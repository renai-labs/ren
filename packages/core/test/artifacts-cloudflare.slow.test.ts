import { describe, expect, setDefaultTimeout } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Artifact } from "@ren/schema/artifact"
import { eq } from "drizzle-orm"
import { ConfigProvider, Effect, FileSystem, Layer, Option, Schedule } from "effect"
import { ArtifactCloudflare } from "../src/artifact-provider/cloudflare.js"
import { Artifacts } from "../src/artifacts.js"
import { ArtifactProvider } from "../src/artifact-provider.js"
import { DurableRunner } from "../src/durable-runner.js"
import { ArtifactSamples } from "./lib/artifact-samples.js"
import { TestDrives } from "./lib/drives.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"
import { TestCloudflare } from "./lib/cloudflare.js"
import { join } from "node:path"
import { tmpdir } from "node:os"

setDefaultTimeout(600_000)

const it = testEffect(
  Artifacts.layer.pipe(
    Layer.provide(ArtifactCloudflare.layer),
    Layer.provideMerge(DurableRunner.layerEffect),
    Layer.provide(TestDrives.layer),
    Layer.provideMerge(Layer.mergeAll(Testing.layer, TestCloudflare.layer)),
  ),
)
const text = (value: string) => new TextEncoder().encode(value)
const failureRoot = join(tmpdir(), "opencode", `artifact-timeout-${crypto.randomUUID()}`)
const bounded = testEffect(
  Artifacts.layer.pipe(
    Layer.provide(
      ArtifactCloudflare.layer.pipe(
        Layer.provide(
          ConfigProvider.layerAdd(
            ConfigProvider.fromUnknown({
              ARTIFACT_CLOUDFLARE_ROOT: failureRoot,
              ARTIFACT_CLOUDFLARE_UPLOAD_TIMEOUT: "1 millis",
              ARTIFACT_CLOUDFLARE_RECOVERY_TIMEOUT: "250 millis",
            }),
            { asPrimary: true },
          ),
        ),
      ),
    ),
    Layer.provideMerge(DurableRunner.layerEffect),
    Layer.provide(TestDrives.layer),
    Layer.provideMerge(Layer.mergeAll(Testing.layer, TestCloudflare.layer)),
  ),
)

describe.skipIf(process.env.REN_ARTIFACT_CLOUDFLARE_LIVE !== "1")(
  "real Cloudflare through Ren's durable Artifact workflows",
  () => {
    bounded.live(
      "bounds a real Wrangler timeout, cleans staging, and repairs pending state with a fresh provider",
      () =>
        Effect.gen(function* () {
          const artifacts = yield* Artifacts.Service
          const database = yield* Database.Service
          const fs = yield* FileSystem.FileSystem
          yield* Effect.addFinalizer(() => fs.remove(failureRoot, { recursive: true }).pipe(Effect.ignore))
          const owner = yield* Seed.owner()
          const id = Artifact.ID.make(`art_${crypto.randomUUID().replaceAll("-", "")}`)
          const deploymentId = Artifact.DeploymentID.make(crypto.randomUUID())
          yield* artifacts.deploy(owner, id, {
            deploymentId,
            title: "Bounded upload",
            config: { entry: "index.html" },
            files: { "index.html": text("source retained after timeout") },
          })
          yield* ArtifactSamples.idle(id).pipe(Effect.timeout("15 seconds"))
          const status = yield* artifacts.status(owner, id, deploymentId)
          expect(status.status).toBe("failed")
          expect(status.error).toContain("Recovery remains pending")
          expect(yield* fs.readDirectory(failureRoot)).toEqual([])
          expect(new TextDecoder().decode((yield* artifacts.files(owner, id))["index.html"])).toBe(
            "source retained after timeout",
          )
          const row = (yield* database.db
            .select()
            .from(Database.Schema.artifact)
            .where(eq(Database.Schema.artifact.id, id))).at(0)
          if (!row?.code_archive) return yield* Effect.die(new Error("Failed deployment lost its source archive"))
          const archive = row.code_archive
          yield* Effect.gen(function* () {
            const provider = yield* ArtifactProvider.Service
            yield* Effect.addFinalizer(() => provider.stop(id, Option.none()).pipe(Effect.ignore))
            const restored = yield* provider.deploy({
              artifactId: id,
              deploymentId: Artifact.DeploymentID.make(crypto.randomUUID()),
              archive,
              config: { entry: "index.html" },
              previous: Option.none(),
            })
            expect(yield* Effect.promise(() => fetch(restored.url).then((response) => response.text()))).toBe(
              "source retained after timeout",
            )
          }).pipe(
            Effect.scoped,
            Effect.provide(
              ArtifactCloudflare.layer.pipe(
                Layer.fresh,
                Layer.provide(TestDrives.layer),
                Layer.provide(TestCloudflare.layer),
              ),
            ),
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
            (yield* artifacts.deploy(owner, id, { deploymentId, title: "Cloudflare live sample", config, files }))
              .status,
          ).toBe("deploying")
          yield* idle
          return yield* artifacts.status(owner, id, deploymentId)
        })
        yield* Effect.addFinalizer(() => artifacts.stop(owner, id).pipe(Effect.ignore))
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
            previous: Option.fromNullishOr(saved?.binding),
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
        yield* artifacts.deploy(owner, id, {
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
