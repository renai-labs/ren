export * as InferenceSetup from "./setup.js"

import { RenInference } from "@ren/schema/ren-inference"
import { Clock, Effect, FileSystem, Option, Result, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { hostname } from "node:os"
import { join } from "node:path"
import { Directories } from "../directories.js"
import { InfraCommand } from "../infra/command.js"
import { Connection } from "../services/connection.js"
import { Output } from "../services/output.js"
import { HarnessFiles } from "./files.js"

export interface Options {
  readonly harnessId: RenInference.HarnessId
  readonly keyEnvVar: Option.Option<string>
  readonly withOptional: boolean
  readonly dryRun: boolean
  readonly yes: boolean
}

const checks: Readonly<Record<RenInference.HarnessId, string>> = {
  "claude-code": "claude -p 'which model are you?'",
  opencode: "opencode run --model ren/anthropic/claude-sonnet-5-5 'say hello'",
  codex: "codex --profile ren",
  pi: "pi --provider ren --model anthropic/claude-sonnet-5-5 -p 'hello'",
  hermes: "hermes -z 'hello'",
}

interface Remembered extends Schema.Schema.Type<typeof Remembered> {}
const Remembered = Schema.Struct({
  harnessId: RenInference.HarnessId,
  keyId: Schema.String,
  keyEnvVar: Schema.optional(Schema.String),
  withOptional: Schema.Boolean,
  time: Schema.String,
})

const State = Schema.Struct({ harnesses: Schema.Array(Remembered) })

const StateJson = Schema.fromJsonString(State)

export const statePath = () => join(Directories.config(), "inference.json")

const fail = (message: string) => new Output.Failure({ message })

const readState = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  if (!(yield* fs.exists(statePath()))) return { harnesses: [] }
  return yield* fs.readFileString(statePath()).pipe(Effect.flatMap(Schema.decodeEffect(StateJson)))
})

const remember = Effect.fnUntraced(function* (entry: Remembered) {
  const fs = yield* FileSystem.FileSystem
  const state = yield* readState
  const harnesses = [...state.harnesses.filter((each) => each.harnessId !== entry.harnessId), entry]
  yield* fs.makeDirectory(Directories.config(), { recursive: true })
  yield* fs.writeFileString(statePath(), `${yield* Schema.encodeEffect(StateJson)({ harnesses })}\n`, { mode: 0o600 })
})

const codexVersion = () =>
  Result.try(() => Bun.spawnSync(["codex", "--version"])).pipe(
    Result.map((run) => (run.success ? /\d+\.\d+\.\d+/u.exec(run.stdout.toString())?.at(0) : undefined)),
    Result.getOrElse(() => undefined),
  )

const CodexModels = Schema.Struct({ models: Schema.NonEmptyArray(Schema.Record(Schema.String, Schema.Json)) })

// oxlint-disable-next-line ren/no-comments -- Codex reads its model list from a file; the base URL's /v1/models answers it for the key and the Codex version. Without Codex on PATH there is no version to ask for.
const codexModels = Effect.fnUntraced(function* (baseUrl: string, key: string) {
  const version = codexVersion()
  if (!version) return Option.none()
  const http = yield* HttpClient.HttpClient
  const url = `${baseUrl.replace(/\/+$/u, "")}/v1/models?client_version=${encodeURIComponent(version)}`
  return yield* http.execute(HttpClientRequest.get(url).pipe(HttpClientRequest.bearerToken(key))).pipe(
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(CodexModels)),
    Effect.timeout("10 seconds"),
    Effect.option,
  )
})

const codexCatalogPath = "~/.codex/ren-models.json"

const withCatalog = (operation: RenInference.HarnessOperation): RenInference.HarnessOperation =>
  operation.kind === "replace-ren-owned-file" && operation.target.kind === "codex-profile"
    ? { ...operation, value: { ...operation.value, model_catalog_json: codexCatalogPath } }
    : operation

const largest = 200

const render = (entries: ReadonlyArray<HarnessFiles.Entry>, key: string) =>
  entries
    .flatMap((entry) => {
      const header = `${entry.display}${entry.existed ? "" : " (new file)"}${typeof entry.after === "string" ? "" : " (removed)"}`
      const lines = InfraCommand.edits(entry.before.split("\n"), (entry.after ?? "").split("\n"))
      const shown =
        lines.length > largest
          ? [`  … ${lines.filter((line) => line.mark !== " ").length} lines change`]
          : lines.map((line) => `  ${line.mark} ${line.text}`)
      return [header, ...shown, ""]
    })
    .join("\n")
    .replaceAll(key, `${key.slice(0, 12)}…`)

// oxlint-disable-next-line ren/no-comments -- The member's newest live key that the member can read, else a new one.
const keyFor = Effect.fnUntraced(function* (client: Connection.Client, options: { readonly create: boolean }) {
  const listed = yield* client["ren-inference"].key.list()
  const live = listed.keys.filter((key) => key.status === "active")
  for (const key of live) {
    const read = yield* client["ren-inference"].key.secret({ id: key.id }).pipe(
      Effect.map(Option.some),
      Effect.catchTag("ForbiddenError", () => Effect.succeed(Option.none())),
    )
    if (Option.isSome(read)) return { id: key.id, secret: read.value.secret, baseUrl: read.value.baseUrl, made: false }
  }
  if (!options.create) return { id: undefined, secret: HarnessFiles.placeholder, baseUrl: listed.baseUrl, made: false }
  const created = yield* client["ren-inference"].key.create({ name: `ren2 on ${hostname()}`, expiresIn: "never" })
  return { id: created.id, secret: created.secret, baseUrl: created.baseUrl, made: true }
})

const configure = Effect.fnUntraced(function* (
  client: Connection.Client,
  key: { readonly secret: string; readonly baseUrl: string },
  options: Options,
) {
  const plan = yield* client["ren-inference"]["harness-plan"]({
    harnessId: options.harnessId,
    ...(Option.isSome(options.keyEnvVar) && { keyEnvVar: options.keyEnvVar.value }),
    withOptional: options.withOptional,
    schemaVersions: [RenInference.harnessPlanSchemaVersion],
    supportedMutationKinds: [...RenInference.harnessOperationKinds],
  })
  if (plan.setupPlan.operations.length === 0)
    return yield* fail(
      `Ren has no models that ${options.harnessId} can use yet. Connect a subscription in Settings → Providers.`,
    )
  const chosen = plan.setupPlan.operations.filter((operation) => options.withOptional || operation.optional !== true)
  const keyed = yield* Effect.forEach(chosen, (operation) => HarnessFiles.withKey(operation, key.secret))
  const catalog =
    options.harnessId === "codex" && key.secret !== HarnessFiles.placeholder
      ? yield* codexModels(key.baseUrl, key.secret)
      : Option.none()
  const models = Option.map(catalog, (found): RenInference.HarnessOperation => ({
    kind: "replace-ren-owned-file",
    target: { kind: "codex-model-catalog", profileName: "ren" },
    format: "json",
    value: found,
    description: "Codex’s model list for Ren",
    containsSecret: false,
  }))
  // oxlint-disable-next-line ren/no-comments -- Codex reads Ren's model list only through the profile's model_catalog_json, and refuses to start when that file is missing, so the line goes in only with the file.
  const profiled = Option.isSome(models) ? keyed.map(withCatalog) : keyed
  const entries = yield* HarnessFiles.build([...profiled, ...Option.toArray(models)])
  const notes = [
    ...plan.warnings,
    ...(options.harnessId === "codex" && Option.isNone(catalog)
      ? [
          "Skipped Codex’s model list: Codex is not on PATH, or Ren sent no list for it. Ren’s models still work by name.",
        ]
      : []),
  ]
  return { entries, notes }
})

const run = Effect.fnUntraced(function* (options: Options) {
  const output = yield* Output.Service
  const connection = yield* Connection.Service
  const client = yield* connection.client
  if (!options.dryRun && !options.yes && !output.interactive)
    return yield* fail("Without a terminal, pass --yes to write the files, or --dry-run to see them.")
  const key = yield* keyFor(client, { create: !options.dryRun })
  const revokeMade =
    key.made && key.id ? client["ren-inference"].key.revoke({ id: key.id }).pipe(Effect.ignore) : Effect.void
  const written = yield* Effect.gen(function* () {
    const configured = yield* configure(client, key, options)
    yield* output.diagnostic(render(configured.entries, key.secret))
    for (const note of configured.notes) yield* output.diagnostic(note)
    if (configured.entries.length === 0) return { dir: undefined, entries: configured.entries }
    if (options.dryRun) return yield* Effect.succeed({ dir: undefined, entries: [] })
    if (!options.yes && !(yield* output.confirm("yes"))) return yield* fail("Setup cancelled.")
    return { dir: yield* HarnessFiles.write(options.harnessId, configured.entries), entries: configured.entries }
  }).pipe(Effect.onError(() => revokeMade))
  if (options.dryRun) return yield* output.print("Dry run: nothing was written.")
  if (key.id) {
    yield* remember({
      harnessId: options.harnessId,
      keyId: key.id,
      ...(Option.isSome(options.keyEnvVar) && { keyEnvVar: options.keyEnvVar.value }),
      withOptional: options.withOptional,
      time: new Date(yield* Clock.currentTimeMillis).toISOString(),
    })
  }
  yield* output.result(
    Schema.Struct({
      harness: RenInference.HarnessId,
      keyId: Schema.optional(Schema.String),
      written: Schema.Array(Schema.String),
      backup: Schema.optional(Schema.String),
    }),
    {
      harness: options.harnessId,
      keyId: key.id,
      written: written.entries.map((entry) => entry.display),
      backup: written.dir,
    },
    [
      written.entries.length === 0
        ? "Nothing to change: the harness already uses Ren."
        : `Set up ${options.harnessId}.`,
      ...(written.dir ? [`Backed up to ${written.dir}. Undo with ren2 inference setup --undo.`] : []),
      `Check it: ${checks[options.harnessId]}`,
    ].join("\n"),
  )
})

export const setup = Effect.fn("InferenceSetup.setup")(function* (input: {
  readonly harness: Option.Option<RenInference.HarnessId>
  readonly keyEnv: Option.Option<string>
  readonly withOptional: boolean
  readonly dryRun: boolean
  readonly yes: boolean
  readonly undo: boolean
}) {
  const output = yield* Output.Service
  if (input.undo) {
    if (output.interactive && !input.yes && !(yield* output.confirm("yes"))) return yield* fail("Undo cancelled.")
    const restored = yield* HarnessFiles.undo()
    return yield* output.result(
      Schema.Struct({ backup: Schema.String, harness: Schema.String, restored: Schema.Array(Schema.String) }),
      { backup: restored.dir, harness: restored.harness, restored: restored.restored },
      `Restored ${restored.restored.length} ${restored.restored.length === 1 ? "file" : "files"} of the ${restored.harness} setup.`,
    )
  }
  if (Option.isNone(input.harness)) return yield* fail(`Name a harness: ${RenInference.HarnessId.literals.join(", ")}.`)
  yield* run({
    harnessId: input.harness.value,
    keyEnvVar: input.keyEnv,
    withOptional: input.withOptional,
    dryRun: input.dryRun,
    yes: input.yes,
  })
})

export const sync = Effect.fn("InferenceSetup.sync")(function* () {
  const output = yield* Output.Service
  const state = yield* readState
  if (state.harnesses.length === 0) return yield* fail("ren2 has set up no harness here. Run ren2 inference setup.")
  for (const entry of state.harnesses)
    yield* run({
      harnessId: entry.harnessId,
      keyEnvVar: Option.fromUndefinedOr(entry.keyEnvVar),
      withOptional: entry.withOptional,
      dryRun: false,
      yes: true,
    }).pipe(Effect.tapError((error) => output.diagnostic(`${entry.harnessId}: ${error.message}`)))
})
