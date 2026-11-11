export * as ArtifactCloudflare from "./cloudflare.js"

import { GetObjectCommand, NoSuchKey, PutObjectCommand } from "@aws-sdk/client-s3"
import { Artifact } from "@ren/schema/artifact"
import { Config, Duration, Effect, FileSystem, Layer, Option, Result, Schedule, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { ChildProcessSpawner } from "effect/process"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { ArtifactArchive } from "../artifact-archive.js"
import { ArtifactProvider } from "../artifact-provider.js"
import { ObjectStorage } from "../object-storage.js"
import { ArtifactCloudflareCode } from "./cloudflare-code.js"
import { ArtifactCloudflarePlan } from "./cloudflare-plan.js"
import { ArtifactCloudflareUpload } from "./cloudflare-upload.js"

export const id = Artifact.ProviderID.make("cloudflare")

const Version = Schema.Struct({ deploymentId: Artifact.DeploymentID, proof: Schema.String.check(Schema.isUUID()) })
type Version = typeof Version.Type
const Snapshot = Schema.Struct({ ...Version.fields, config: Artifact.Config, archive: Schema.NonEmptyString })
type Snapshot = typeof Snapshot.Type
const State = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.Literal(2),
    account: Schema.String,
    script: Schema.String,
    subdomain: Schema.String,
    plan: ArtifactCloudflarePlan.State,
    active: Schema.NullOr(Snapshot),
    pending: Schema.NullOr(Schema.Struct({ ...Snapshot.fields, ready: Schema.Boolean })),
    stopped: Schema.Boolean,
    stop: Schema.NullOr(Version),
    publication: Schema.optional(Schema.String),
  }),
)
type State = typeof State.Type
const Binding = Schema.Struct({ account: Schema.String, script: Schema.String, deploymentId: Artifact.DeploymentID })
type Binding = typeof Binding.Type
const Metadata = Schema.Struct({
  result: Schema.Struct({
    default_environment: Schema.Struct({ script: Schema.Struct({ etag: Schema.NonEmptyString }) }),
  }),
})
const Subdomain = Schema.Struct({ result: Schema.Struct({ subdomain: Schema.NonEmptyString }) })
const failed = (error: unknown) =>
  new ArtifactProvider.Failed({ message: error instanceof Error ? error.message : String(error) })
const deployed = (state: State, snapshot: Snapshot) => ({
  binding: { account: state.account, script: state.script, deploymentId: snapshot.deploymentId },
  url: `https://${state.script}.${state.subdomain}.workers.dev${snapshot.config.entry === "index.html" ? "/" : `/${snapshot.config.entry}`}`,
})

export const layer = Layer.effect(
  ArtifactProvider.Service,
  Effect.gen(function* () {
    const config = yield* Config.all({
      account: Config.NonEmptyString("CLOUDFLARE_ACCOUNT_ID"),
      token: Config.Redacted("CLOUDFLARE_API_TOKEN"),
      root: Config.String("ARTIFACT_CLOUDFLARE_ROOT").pipe(
        Config.withDefault(join(tmpdir(), "ren-artifacts-cloudflare")),
      ),
      node: Config.String("ARTIFACT_NODE").pipe(Config.withDefault("node")),
      namespace: Config.option(Config.String("ARTIFACT_CLOUDFLARE_NAMESPACE")),
      uploadWithin: Config.Duration("ARTIFACT_CLOUDFLARE_UPLOAD_TIMEOUT").pipe(
        Config.withDefault(Duration.seconds(55)),
      ),
      recoverWithin: Config.Duration("ARTIFACT_CLOUDFLARE_RECOVERY_TIMEOUT").pipe(
        Config.withDefault(Duration.seconds(25)),
      ),
    })
    if (Option.isSome(config.namespace))
      return yield* failed(
        "WFP dispatch is not implemented: omit ARTIFACT_CLOUDFLARE_NAMESPACE to use ordinary Workers",
      )
    const storage = yield* ObjectStorage.Service
    const fs = yield* FileSystem.FileSystem
    const http = yield* HttpClient.HttpClient
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.account)}/workers`
    const api = (request: HttpClientRequest.HttpClientRequest) =>
      http.execute(request.pipe(HttpClientRequest.bearerToken(config.token))).pipe(
        Effect.flatMap((response) => response.json.pipe(Effect.map((body) => ({ status: response.status, body })))),
        Effect.timeout("5 seconds"),
        Effect.mapError(() => failed("Cloudflare API request failed")),
      )
    const subdomainResponse = yield* api(HttpClientRequest.get(`${base}/subdomain`))
    if (subdomainResponse.status !== 200)
      return yield* failed(`Cannot read Cloudflare workers.dev subdomain (${subdomainResponse.status})`)
    const subdomain = (yield* Schema.decodeUnknownEffect(Subdomain)(subdomainResponse.body).pipe(
      Effect.mapError(failed),
    )).result.subdomain
    const wrangler = join(dirname(fileURLToPath(import.meta.resolve("wrangler/package.json"))), "wrangler-dist/cli.js")
    yield* fs.makeDirectory(config.root, { recursive: true }).pipe(Effect.mapError(failed))

    const remote = Effect.fnUntraced(function* (script: string) {
      const response = yield* api(
        HttpClientRequest.get(`${base}/services/${script}`).pipe(
          HttpClientRequest.setHeader("cache-control", "no-cache"),
        ),
      )
      if (response.status === 404) return Option.none<string>()
      if (response.status !== 200) return yield* failed(`Cannot read Cloudflare Worker metadata (${response.status})`)
      const etag = (yield* Schema.decodeUnknownEffect(Metadata)(response.body).pipe(Effect.mapError(failed))).result
        .default_environment.script.etag
      return Option.some(etag.startsWith('"') ? etag : JSON.stringify(etag))
    })
    const probe = (state: State, version: Version) =>
      http
        .execute(
          HttpClientRequest.get(`https://${state.script}.${state.subdomain}.workers.dev/`).pipe(
            HttpClientRequest.setHeader("x-ren-artifact-probe", "1"),
            HttpClientRequest.setHeader("cache-control", "no-cache"),
          ),
        )
        .pipe(
          Effect.flatMap((response) =>
            response.status === 200
              ? response.text.pipe(
                  Effect.map((body) => body === ArtifactCloudflareCode.marker(version.deploymentId, version.proof)),
                )
              : Effect.succeed(false),
          ),
          Effect.timeout("3 seconds"),
          Effect.orElseSucceed(() => false),
        )
    const ready = (state: State, version: Version, source: Option.Option<Snapshot>) =>
      Effect.all(
        {
          marker: probe(state, version),
          route: http
            .get(
              `https://${state.script}.${state.subdomain}.workers.dev${Option.isSome(source) && source.value.config.entry !== "index.html" ? `/${source.value.config.entry}` : "/"}`,
            )
            .pipe(
              Effect.map((response) =>
                Option.isSome(source) ? response.status >= 200 && response.status < 400 : response.status === 410,
              ),
              Effect.timeout("3 seconds"),
              Effect.orElseSucceed(() => false),
            ),
        },
        { concurrency: "unbounded" },
      ).pipe(
        Effect.map((result) => result.marker && result.route),
        Effect.repeat({ schedule: Schedule.spaced("1 second"), until: Boolean }),
        Effect.timeout("25 seconds"),
        Effect.mapError(() => failed("Cloudflare did not serve the matching artifact deployment version")),
      )

    const upload = Effect.fnUntraced(
      function* (state: State, source: Option.Option<Snapshot>, version: Version, guard: Option.Option<string>) {
        const directory = yield* fs.makeTempDirectoryScoped({ directory: config.root, prefix: `${state.script}-` })
        const archiveSource = Option.orElse(source, () => Option.fromNullishOr(state.active ?? state.pending))
        const files = Option.isSome(archiveSource)
          ? yield* ArtifactArchive.read(storage, archiveSource.value.archive)
          : {}
        const objects = Option.isSome(source) ? (source.value.config.durableObjects ?? {}) : {}
        if (Object.keys(objects).length && !files[Artifact.workerPath])
          return yield* failed("Durable Objects require _worker.js with exported classes")
        const modules = ArtifactCloudflareCode.modules({
          ...version,
          objects: state.plan.objects,
          mode: Option.isSome(source) ? "serving" : "stopped",
          active:
            Option.isSome(source) && files[Artifact.workerPath]
              ? { source: new TextDecoder().decode(files[Artifact.workerPath]), classes: Object.values(objects) }
              : null,
        })
        yield* fs.makeDirectory(join(directory, "worker"))
        yield* Effect.forEach(
          Object.entries(modules),
          ([path, text]) => fs.writeFileString(join(directory, "worker", path), text),
          { concurrency: 4 },
        )
        if (Option.isSome(archiveSource)) {
          yield* fs.makeDirectory(join(directory, "public"))
          yield* Effect.forEach(
            Object.entries(files).filter(([path]) => path !== Artifact.workerPath),
            ([path, bytes]) =>
              fs
                .makeDirectory(dirname(join(directory, "public", path)), { recursive: true })
                .pipe(Effect.andThen(fs.writeFile(join(directory, "public", path), bytes))),
            { concurrency: 4 },
          )
        }
        yield* fs.writeFileString(
          join(directory, "parent.mjs"),
          'process.stdin.resume(); process.stdin.unref?.(); process.stdin.once("end", () => process.exit(1));',
        )
        yield* fs.writeFileString(
          join(directory, "wrangler.json"),
          JSON.stringify({
            name: state.script,
            main: "worker/main.js",
            base_dir: "worker",
            no_bundle: true,
            find_additional_modules: true,
            rules: [{ type: "ESModule", globs: ["active.js", "retained-*.js"] }],
            compatibility_date: "2026-06-01",
            workers_dev: true,
            preview_urls: false,
            ...(Option.isSome(archiveSource) && {
              assets: { directory: "public", binding: "ASSETS", run_worker_first: true },
            }),
            durable_objects: {
              code_update_strategy: { mode: "immediate" },
              bindings: Object.entries(objects).map(([name, className]) => ({
                name,
                class_name: className,
              })),
            },
            exports: ArtifactCloudflarePlan.exports(state.plan.objects),
          }),
        )
        return yield* ArtifactCloudflareUpload.stage({
          account: config.account,
          script: state.script,
          token: config.token,
          node: config.node,
          directory,
          wrangler,
          guard,
        }).pipe(
          Effect.provideService(HttpClient.HttpClient, http),
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.timeout(Duration.min(config.uploadWithin, Duration.seconds(55))),
        )
      },
      Effect.scoped,
      Effect.mapError(failed),
    )

    const access = Effect.fnUntraced(function* (artifactId: Artifact.ID, binding: Option.Option<Binding>) {
      const key = `artifact-provider/cloudflare/${artifactId}/state.json`
      const object = yield* Effect.tryPromise({
        try: async (signal) => {
          const object = await storage.s3
            .send(new GetObjectCommand({ Bucket: storage.bucket, Key: key }), { abortSignal: signal })
            .catch((error: unknown) => (error instanceof NoSuchKey ? undefined : Promise.reject(failed(error))))
          return object ? { etag: object.ETag, body: (await object.Body?.transformToString()) ?? "" } : undefined
        },
        catch: failed,
      }).pipe(Effect.timeout("5 seconds"), Effect.mapError(failed))
      const initial = object
        ? yield* Schema.decodeUnknownEffect(State)(object.body).pipe(
            Effect.mapError(() =>
              failed(
                "Cloudflare recovery state is invalid or predates archive-reference format 2. Migrate it explicitly or use a new artifact; the existing Worker and SQLite data were not changed.",
              ),
            ),
          )
        : null
      if (!initial && Option.isSome(binding))
        return yield* failed(
          "Cloudflare artifact recovery state is missing; refusing to replace an existing deployment",
        )
      if (
        Option.exists(
          Option.fromNullishOr(initial),
          (state) => state.account !== config.account || state.subdomain !== subdomain,
        )
      )
        return yield* failed(
          "This artifact belongs to another Cloudflare account/subdomain; provider migration is not supported",
        )
      let etag = object?.etag
      let current: State = initial ?? {
        version: 2,
        account: config.account,
        script: ArtifactCloudflareCode.name(artifactId),
        subdomain,
        plan: { objects: {} },
        active: null,
        pending: null,
        stopped: true,
        stop: null,
      }
      if (
        Option.exists(binding, (previous) => previous.account !== config.account || previous.script !== current.script)
      )
        return yield* failed("Artifact Cloudflare binding does not match this account/artifact")
      const save = Effect.fnUntraced(function* (state: State) {
        const body = yield* Schema.encodeEffect(State)(state).pipe(Effect.mapError(failed))
        const result = yield* Effect.tryPromise({
          try: (signal) =>
            storage.s3.send(
              new PutObjectCommand({
                Bucket: storage.bucket,
                Key: key,
                Body: body,
                ContentType: "application/json",
                ...(etag ? { IfMatch: etag } : { IfNoneMatch: "*" }),
              }),
              { abortSignal: signal },
            ),
          catch: failed,
        }).pipe(Effect.timeout("5 seconds"), Effect.mapError(failed))
        etag = result.ETag
        current = state
      })
      if (
        current.pending?.ready &&
        Option.exists(binding, (previous) => previous.deploymentId === current.pending?.deploymentId)
      )
        yield* save({ ...current, active: current.pending, pending: null })

      const publish = Effect.fnUntraced(function* (source: Option.Option<Snapshot>, version: Version) {
        const guard = yield* remote(current.script)
        if (Option.isNone(guard) && (current.active || current.publication))
          return yield* failed(
            "The previously published Cloudflare Worker is missing; refusing to recreate its namespaces",
          )
        yield* save({ ...current })
        const etag = yield* upload(current, source, version, guard)
        yield* save({ ...current, publication: etag })
        const route = yield* api(HttpClientRequest.get(`${base}/scripts/${current.script}/subdomain`))
        const serving =
          route.status === 200
            ? yield* Schema.decodeUnknownEffect(
                Schema.Struct({ result: Schema.Struct({ enabled: Schema.Boolean, previews_enabled: Schema.Boolean }) }),
              )(route.body).pipe(Effect.mapError(failed))
            : null
        if (!serving?.result.enabled || serving.result.previews_enabled) {
          const enable = yield* HttpClientRequest.post(`${base}/scripts/${current.script}/subdomain`).pipe(
            HttpClientRequest.bodyJson({ enabled: true, previews_enabled: false }),
            Effect.mapError(failed),
          )
          const enabled = yield* api(enable)
          if (enabled.status !== 200)
            return yield* failed(`Cannot enable the artifact public route (${enabled.status})`)
        }
        yield* ready(current, version, source)
      })
      const recover = Effect.fnUntraced(
        function* () {
          const version = {
            ...(current.active && !current.stopped
              ? current.active
              : (current.stop ?? { deploymentId: Artifact.DeploymentID.make(crypto.randomUUID()) })),
            proof: crypto.randomUUID(),
          }
          if (current.active && !current.stopped)
            yield* save({ ...current, active: { ...current.active, proof: version.proof } })
          else yield* save({ ...current, stopped: true, stop: version })
          yield* publish(current.active && !current.stopped ? Option.some(current.active) : Option.none(), version)
          yield* save({ ...current, pending: null })
        },
        Effect.timeout(Duration.min(config.recoverWithin, Duration.seconds(25))),
        Effect.mapError(failed),
      )
      return { initial, state: () => current, save, publish, recover }
    })

    return ArtifactProvider.make({
      id,
      binding: Binding,
      deploy: Effect.fn("ArtifactCloudflare.deploy")(function* (input) {
        const stored = yield* access(input.artifactId, input.previous)
        if (
          Option.exists(
            Option.fromNullishOr(stored.state().pending),
            (pending) => pending.deploymentId !== input.deploymentId,
          )
        )
          yield* stored.recover()
        const before = stored.state()
        const reusable = Option.fromNullishOr(before.pending?.ready ? before.pending : before.active).pipe(
          Option.filter((snapshot) => snapshot.deploymentId === input.deploymentId && !before.stopped),
        )
        if (Option.isSome(reusable) && (yield* probe(before, reusable.value))) return deployed(before, reusable.value)
        const bindings = ArtifactCloudflarePlan.bindings({
          active: before.active?.config.durableObjects ?? {},
          retained: before.plan.objects,
          desired: input.config.durableObjects ?? {},
        })
        if (Result.isFailure(bindings)) return yield* failed(bindings.failure)
        const snapshot = {
          deploymentId: input.deploymentId,
          config: input.config,
          archive: input.archive,
          proof: Option.fromNullishOr(before.pending).pipe(
            Option.filter((pending) => pending.deploymentId === input.deploymentId),
            Option.map((pending) => pending.proof),
            Option.getOrElse(() => crypto.randomUUID()),
          ),
        }
        yield* stored.save({ ...before, plan: { objects: bindings.success }, pending: { ...snapshot, ready: false } })
        yield* Effect.gen(function* () {
          yield* stored.publish(Option.some(snapshot), snapshot)
          yield* stored.save({ ...stored.state(), pending: { ...snapshot, ready: true }, stopped: false, stop: null })
        }).pipe(
          Effect.timeout("70 seconds"),
          Effect.mapError(failed),
          Effect.catch((error) =>
            stored.recover().pipe(
              Effect.matchEffect({
                onFailure: (recovery) =>
                  Effect.fail(
                    failed(
                      `${error.message}. Recovery remains pending: ${recovery.message}. Retry or stop this artifact before publishing another version.`,
                    ),
                  ),
                onSuccess: () => Effect.fail(error),
              }),
            ),
          ),
          Effect.onInterrupt(() =>
            Effect.logWarning(
              "Cloudflare deployment interrupted; its durable pending state must be reconciled before another version can publish",
            ),
          ),
        )
        return deployed(stored.state(), snapshot)
      }),
      stop: Effect.fn("ArtifactCloudflare.stop")(function* (artifactId, binding) {
        const stored = yield* access(artifactId, binding)
        if (!stored.initial) return
        yield* stored.save({
          ...stored.state(),
          stopped: true,
          stop: stored.state().stop ?? {
            deploymentId: Artifact.DeploymentID.make(crypto.randomUUID()),
            proof: crypto.randomUUID(),
          },
        })
        yield* stored.recover()
      }),
    })
  }),
).pipe(Layer.provide(ObjectStorage.layer))
