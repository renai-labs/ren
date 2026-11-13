export * as ArtifactCloudflare from "./cloudflare.js"

import { Artifact } from "@ren/schema/artifact"
import { Config, Duration, Effect, Layer, Option, Predicate, Redacted, Result, Schedule, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { ArtifactArchive } from "../artifact-archive.js"
import { ArtifactProvider } from "../artifact-provider.js"
import { ObjectStorage } from "../object-storage.js"
import { ArtifactCloudflareCode } from "./cloudflare-code.js"
import { ArtifactDurableObjects } from "./durable-objects.js"

export const id = Artifact.ProviderID.make("cloudflare")

const Version = Schema.Struct({ deploymentId: Artifact.DeploymentID, proof: Schema.String.check(Schema.isUUID()) })
type Version = typeof Version.Type
const Snapshot = Schema.Struct({ ...Version.fields, config: Artifact.Config, archive: Schema.NonEmptyString })
type Snapshot = typeof Snapshot.Type
export const State = Schema.Struct({
  version: Schema.Literal(3),
  account: Schema.String,
  namespace: Schema.String,
  script: Schema.String,
  plan: ArtifactDurableObjects.State,
  active: Schema.NullOr(Snapshot),
  pending: Schema.NullOr(Schema.Struct({ ...Snapshot.fields, ready: Schema.Boolean })),
  stopped: Schema.Boolean,
  stop: Schema.NullOr(Version),
  publication: Schema.optional(Schema.String),
})
type State = typeof State.Type
// oxlint-disable-next-line ren/no-comments -- A dispatch namespace answers 200 with a null script for a name it does not have, not 404.
const Metadata = Schema.Struct({
  result: Schema.Struct({ script: Schema.NullOr(Schema.Struct({ etag: Schema.NonEmptyString })) }),
})
const UploadSession = Schema.Struct({
  result: Schema.Struct({ jwt: Schema.NonEmptyString, buckets: Schema.Array(Schema.Array(Schema.String)) }),
})
const UploadAnswer = Schema.Struct({ result: Schema.Struct({ jwt: Schema.optional(Schema.NonEmptyString) }) })
const Uploaded = Schema.Struct({ result: Schema.Struct({ etag: Schema.NonEmptyString }) })
const failed = (error: unknown, options: { readonly retryable: boolean } = { retryable: false }) =>
  error instanceof ArtifactProvider.Failed
    ? error
    : new ArtifactProvider.Failed({
        message: error instanceof Error ? error.message : String(error),
        retryable: options.retryable,
      })
// oxlint-disable-next-line ren/no-comments -- Cloudflare answers 5xx while it has a problem, and 412 when another upload changed the Worker; the same call can succeed later.
const retryableStatus = (status: number) => ({ retryable: status === 412 || status >= 500 })
// oxlint-disable-next-line ren/no-comments -- A refusal keeps Cloudflare's status and its own error text, so the deployment's error says what Cloudflare said.
const refused = (what: string, status: number, body: unknown) =>
  failed(
    `${what} (HTTP ${status}): ${(Predicate.isString(body) ? body : JSON.stringify(Predicate.hasProperty(body, "errors") ? body.errors : body)).slice(0, 1000)}`,
    retryableStatus(status),
  )
// oxlint-disable-next-line ren/no-comments -- The whole budget of one call, its recovery included.
const budget = Duration.minutes(2)
const budgeted = <A>(call: Effect.Effect<A, ArtifactProvider.Failed>) =>
  call.pipe(
    Effect.timeoutOrElse({
      duration: budget,
      orElse: () => Effect.fail(failed(`Cloudflare did not finish within ${Duration.format(budget)}`)),
    }),
  )
const apiBase = (account: string) =>
  `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/workers`
const scriptBase = (input: { readonly account: string; readonly namespace: string; readonly script: string }) =>
  `${apiBase(input.account)}/dispatch/namespaces/${encodeURIComponent(input.namespace)}/scripts/${input.script}`

// oxlint-disable-next-line ren/no-comments -- Uploads a Worker to a dispatch namespace: one multipart PUT of its metadata and its ES modules. guard is the ETag of the upload it replaces, or none for a new Worker; Cloudflare refuses a stale guard with 412.
export const putScript = Effect.fn("ArtifactCloudflare.putScript")(function* (input: {
  readonly account: string
  readonly namespace: string
  readonly token: Redacted.Redacted
  readonly script: string
  readonly metadata: Readonly<Record<string, unknown>>
  readonly modules: Readonly<Record<string, string>>
  readonly guard: Option.Option<string>
}) {
  const http = yield* HttpClient.HttpClient
  const form = new FormData()
  form.append("metadata", JSON.stringify(input.metadata))
  for (const name of Object.keys(input.modules))
    form.append(name, new File([input.modules[name] ?? ""], name, { type: "application/javascript+module" }))
  const response = yield* http
    .execute(
      HttpClientRequest.put(scriptBase(input)).pipe(
        HttpClientRequest.bearerToken(input.token),
        HttpClientRequest.bodyFormData(form),
        HttpClientRequest.setHeader(
          Option.isSome(input.guard) ? "if-match" : "if-none-match",
          Option.getOrElse(input.guard, () => "*"),
        ),
      ),
    )
    .pipe(
      Effect.timeout("30 seconds"),
      Effect.mapError(() => failed("Cloudflare did not take the Worker upload", { retryable: true })),
    )
  if (response.status === 412)
    return yield* failed("Cloudflare publication was fenced by a newer upload (HTTP 412)", { retryable: true })
  if (response.status !== 200)
    return yield* refused(
      "Cloudflare refused the Worker upload",
      response.status,
      yield* response.text.pipe(Effect.orElseSucceed(() => "")),
    )
  return (yield* response.json.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Uploaded)),
    Effect.mapError(() => failed("Cloudflare did not return the Worker upload's ETag", { retryable: true })),
  )).result.etag
})

export const layer = Layer.effect(
  ArtifactProvider.Service,
  Effect.gen(function* () {
    const config = yield* Config.all({
      account: Config.NonEmptyString("CLOUDFLARE_ACCOUNT_ID"),
      token: Config.Redacted("CLOUDFLARE_API_TOKEN"),
      namespace: Config.NonEmptyString("ARTIFACT_CLOUDFLARE_NAMESPACE"),
      domain: Config.NonEmptyString("ARTIFACT_DOMAIN"),
      names: Config.option(Config.NonEmptyString("ARTIFACT_CLOUDFLARE_NAMES")),
      recoverWithin: Config.Duration("ARTIFACT_CLOUDFLARE_RECOVERY_TIMEOUT").pipe(
        Config.withDefault(Duration.seconds(25)),
      ),
    })
    // oxlint-disable-next-line ren/no-comments -- The address of an artifact: its host name under the artifact domain. The domain is not the artifact's state: the script in the namespace does not depend on it.
    const origin = (host: string) => `https://${host}.${config.domain}`
    const deployed = (state: State, snapshot: Snapshot) => ({
      remote: { ...state, active: snapshot, pending: null, stopped: false, stop: null },
      url: `${origin(state.script)}${ArtifactProvider.entryPath(snapshot.config)}`,
    })
    const storage = yield* ObjectStorage.Service
    const http = yield* HttpClient.HttpClient
    const base = apiBase(config.account)
    const api = (request: HttpClientRequest.HttpClientRequest) =>
      http.execute(request.pipe(HttpClientRequest.bearerToken(config.token))).pipe(
        Effect.flatMap((response) => response.json.pipe(Effect.map((body) => ({ status: response.status, body })))),
        Effect.timeout("5 seconds"),
        Effect.mapError((cause) => failed(`Cloudflare API request failed: ${cause.message}`, { retryable: true })),
      )

    const workerEtag = Effect.fnUntraced(function* (state: State) {
      const response = yield* api(
        HttpClientRequest.get(scriptBase(state)).pipe(HttpClientRequest.setHeader("cache-control", "no-cache")),
      )
      if (response.status === 404) return Option.none<string>()
      if (response.status !== 200)
        return yield* refused("Cannot read the Cloudflare Worker metadata", response.status, response.body)
      const script = (yield* Schema.decodeUnknownEffect(Metadata)(response.body).pipe(Effect.mapError(failed))).result
        .script
      if (!script) return Option.none<string>()
      return Option.some(script.etag.startsWith('"') ? script.etag : JSON.stringify(script.etag))
    })
    const probe = (state: State, version: Version) =>
      http
        .execute(
          HttpClientRequest.get(`${origin(state.script)}/`).pipe(
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
              `${origin(state.script)}${Option.isSome(source) ? ArtifactProvider.entryPath(source.value.config) : "/"}`,
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

    // oxlint-disable-next-line ren/no-comments -- Direct upload: Cloudflare names the assets it lacks by hash in buckets, takes each bucket under the session's token, and answers the last one with the token the Worker upload attaches.
    const uploadAssets = Effect.fnUntraced(function* (state: State, files: Readonly<Record<string, Uint8Array>>) {
      const hashed = Object.keys(files).flatMap((path) => {
        const bytes = files[path]
        return bytes ? [{ path, bytes, hash: ArtifactCloudflareCode.assetHash(path, bytes) }] : []
      })
      const session = yield* api(
        HttpClientRequest.post(`${scriptBase(state)}/assets-upload-session`).pipe(
          HttpClientRequest.bodyJsonUnsafe({
            manifest: Object.fromEntries(
              hashed.map((asset) => [`/${asset.path}`, { hash: asset.hash, size: asset.bytes.byteLength }]),
            ),
          }),
        ),
      )
      if (session.status !== 200)
        return yield* refused("Cloudflare did not start the asset upload", session.status, session.body)
      const started = (yield* Schema.decodeUnknownEffect(UploadSession)(session.body).pipe(Effect.mapError(failed)))
        .result
      if (started.buckets.length === 0) return started.jwt
      const byHash = new Map(hashed.map((asset) => [asset.hash, asset]))
      const answers = yield* Effect.forEach(
        started.buckets,
        Effect.fnUntraced(function* (bucket) {
          const form = new FormData()
          for (const hash of bucket) {
            const asset = byHash.get(hash)
            if (!asset) return yield* failed(`Cloudflare asked for an asset Ren did not send (${hash})`)
            form.append(hash, new File([asset.bytes.toBase64()], hash, { type: Bun.file(asset.path).type }))
          }
          const response = yield* http
            .execute(
              HttpClientRequest.post(`${base}/assets/upload?base64=true`).pipe(
                HttpClientRequest.bearerToken(started.jwt),
                HttpClientRequest.bodyFormData(form),
              ),
            )
            .pipe(
              Effect.timeout("60 seconds"),
              Effect.mapError(() => failed("Cloudflare did not take the assets", { retryable: true })),
            )
          if (![200, 201, 202].includes(response.status))
            return yield* refused(
              "Cloudflare refused the assets",
              response.status,
              yield* response.text.pipe(Effect.orElseSucceed(() => "")),
            )
          return (yield* response.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(UploadAnswer)),
            Effect.mapError(failed),
          )).result.jwt
        }),
        { concurrency: 3 },
      )
      const completion = answers.find(Predicate.isNotUndefined)
      if (!completion) return yield* failed("Cloudflare did not finish the asset upload", { retryable: true })
      return completion
    })

    const upload = Effect.fnUntraced(function* (
      state: State,
      source: Option.Option<Snapshot>,
      version: Version,
      guard: Option.Option<string>,
    ) {
      const archiveSource = Option.orElse(source, () => Option.fromNullishOr(state.active ?? state.pending))
      const files = Option.isSome(archiveSource)
        ? (yield* ArtifactArchive.read(storage, archiveSource.value.archive).pipe(
            Effect.mapError((error) => failed(error, { retryable: error._tag === "ArtifactArchive.Failed" })),
          )).files
        : {}
      const objects = Option.isSome(source) ? (source.value.config.durableObjects ?? {}) : {}
      const modules = ArtifactCloudflareCode.modules({
        ...version,
        objects: state.plan.objects,
        mode: Option.isSome(source) ? "serving" : "stopped",
        active:
          Option.isSome(source) && files[Artifact.workerPath]
            ? { source: new TextDecoder().decode(files[Artifact.workerPath]), classes: Object.values(objects) }
            : null,
      })
      const assets = Option.isSome(archiveSource)
        ? Option.some(
            yield* uploadAssets(
              state,
              Object.fromEntries(Object.entries(files).filter((file) => file.at(0) !== Artifact.workerPath)),
            ),
          )
        : Option.none()
      // oxlint-disable-next-line ren/no-comments -- The metadata Wrangler sends for this Worker, captured from a live deploy.
      const metadata = {
        main_module: "main.js",
        bindings: [
          ...Object.keys(objects).map((name) => ({
            name,
            type: "durable_object_namespace",
            class_name: objects[name],
          })),
          ...(Option.isSome(assets) ? [{ name: "ASSETS", type: "assets" }] : []),
        ],
        compatibility_date: "2026-06-01",
        compatibility_flags: [],
        code_update_strategy: { mode: "immediate" },
        exports: ArtifactDurableObjects.exports(state.plan.objects),
        keep_bindings: ["secret_text", "secret_key"],
        ...(Option.isSome(assets) && { assets: { jwt: assets.value, config: { run_worker_first: true } } }),
      }
      return yield* putScript({
        account: config.account,
        namespace: state.namespace,
        token: config.token,
        script: state.script,
        metadata,
        modules,
        guard,
      }).pipe(Effect.provideService(HttpClient.HttpClient, http))
    })

    // oxlint-disable-next-line ren/no-comments -- The artifact's state, which Ren keeps on its row. save writes it before each change to Cloudflare, so a call after a crash finds what the last one started.
    const access = Effect.fnUntraced(function* (
      artifactId: Artifact.ID,
      remote: Option.Option<State>,
      persist: (state: State) => Effect.Effect<void, ArtifactProvider.Failed>,
    ) {
      const initial = Option.getOrNull(remote)
      if (initial && (initial.account !== config.account || initial.namespace !== config.namespace))
        return yield* failed(
          "This artifact belongs to another Cloudflare account or namespace; provider migration is not supported",
        )
      let current: State = initial ?? {
        version: 3,
        account: config.account,
        namespace: config.namespace,
        script: Artifact.label(artifactId),
        plan: { objects: {} },
        active: null,
        pending: null,
        stopped: true,
        stop: null,
      }
      const save = Effect.fnUntraced(function* (state: State) {
        yield* persist(state)
        current = state
      })

      const publish = Effect.fnUntraced(function* (source: Option.Option<Snapshot>, version: Version) {
        const guard = yield* workerEtag(current)
        if (Option.isNone(guard) && (current.active || current.publication))
          return yield* failed(
            "The previously published Cloudflare Worker is missing; refusing to recreate its namespaces",
          )
        yield* save({ ...current })
        const etag = yield* upload(current, source, version, guard)
        yield* save({ ...current, publication: etag })
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

    // oxlint-disable-next-line ren/no-comments -- The Workers KV namespace where the dispatcher reads which label a name serves.
    const names = Option.map(config.names, (namespace) => {
      const value = (name: Artifact.Name) =>
        `${base.replace(/\/workers$/u, "")}/storage/kv/namespaces/${encodeURIComponent(namespace)}/values/${name}`
      const write = (what: string, request: HttpClientRequest.HttpClientRequest) =>
        api(request).pipe(
          Effect.flatMap((response) =>
            response.status === 200 ? Effect.void : Effect.fail(refused(what, response.status, response.body)),
          ),
        )
      return {
        origin: (artifactId: Artifact.ID, name: Artifact.Name | null) =>
          `https://${name ?? Artifact.label(artifactId)}.${config.domain}`,
        put: (name: Artifact.Name, artifactId: Artifact.ID) =>
          write(
            "Cloudflare refused the artifact name",
            HttpClientRequest.put(value(name)).pipe(HttpClientRequest.bodyText(Artifact.label(artifactId))),
          ),
        remove: (name: Artifact.Name) =>
          write("Cloudflare did not remove the artifact name", HttpClientRequest.delete(value(name))),
      } satisfies ArtifactProvider.Names
    })

    return ArtifactProvider.make({
      id,
      ...(Option.isSome(names) && { names: names.value }),
      remote: State,
      deploy: Effect.fn("ArtifactCloudflare.deploy")(function* (input) {
        const stored = yield* access(input.artifactId, input.remote, input.save)
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
        const bindings = ArtifactDurableObjects.bindings({
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
      }, budgeted),
      stop: Effect.fn("ArtifactCloudflare.stop")(function* (artifactId, remote, save) {
        const stored = yield* access(artifactId, remote, save)
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
      }, budgeted),
    })
  }),
).pipe(Layer.provide(ObjectStorage.layer))
