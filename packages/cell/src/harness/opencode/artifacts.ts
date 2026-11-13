export * as OpenCodeArtifacts from "./artifacts.js"

import { Plugin } from "@opencode/plugin/effect"
import { Tool } from "@opencode/schema/tool"
import type { HandConnections } from "@ren/brain/hand/connections"
import type { HandClient } from "@ren/hand-api/hand-client"
import type { RenHostApi } from "@ren/host-api/ren-host-api"
import { Artifact } from "@ren/schema/artifact"
import { Identifier } from "@ren/schema/identifier"
import { Session } from "@ren/schema/session"
import { Duration, Effect, Option, Predicate, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest } from "effect/http"
import type { HttpApiClient } from "effect/http-api"
import { resolve } from "node:path"
import { HostToken } from "../../host-token.js"
import type { OpenCodeMcp } from "./mcp.js"
import { RenPlugin } from "./plugin.js"
import { Tar } from "./tar.js"

const providerId = "ren"

const answersWithin = Duration.minutes(3)

const prompt = [
  "Publishing is asynchronous. Create and update return a deploymentId; continue working, and Ren sends the result to this chat when the deployment ends. Use artifact_status with the artifact id and deploymentId only when needed, never in a loop. Only report the app as live after the result is ready; report the error when it is failed. Link the exact url of the ready result. During updates, the URL may still serve the previous version.",
  "An update names the deployment it starts from as baseDeploymentId: the deploymentId of your last artifact_read, artifact_create or artifact_update of that artifact. If Ren answers that the artifact changed, read it again with directory and apply your change to those files.",
  `Publish a folder with directory when the artifact has images, fonts or other binary files, or many or large files: every file in it is published as it is, up to ${Artifact.maxFiles} files of ${Artifact.maxFileBytes / 1024 / 1024} MiB each and ${Artifact.maxTotalBytes / 1024 / 1024} MiB in all. Pass files only for a few small text files.`,
  `Static files are served at their paths. ${Artifact.workerPath} handles unmatched requests and can access assets through env.ASSETS.fetch(request). Use an ES-module Worker with a default fetch export. Node APIs are unavailable; bundle dependencies except workerd runtime imports.`,
  `For persistent SQLite, include ${Artifact.manifestPath} with {"durableObjects":{"STATE":"MyState"}}. Export MyState extends DurableObject from ${Artifact.workerPath}, importing DurableObject from cloudflare:workers. Access it through env.STATE.get(env.STATE.idFromName("stable-name")); use this.ctx.storage.sql inside the class.`,
  `For application SQL schema changes, embed an append-only migrations array in ${Artifact.workerPath}: [{id:1,sql:"CREATE TABLE ..."},{id:2,sql:"ALTER TABLE ..."}]. In each Durable Object constructor, synchronously call ctx.storage.transactionSync(() => { create an app_migrations(id INTEGER PRIMARY KEY, sql TEXT NOT NULL) ledger if absent; read its rows ordered by id; reject a database with more applied versions than this code knows; require contiguous IDs starting at 1; compare every applied ID and SQL text exactly; execute only unapplied SQL and INSERT its ID/SQL in that same transaction; }). Let errors escape initialization so requests never run against a partially migrated schema. Never edit, remove or reorder applied migrations. Append backwards-compatible schema changes; no down migrations or automatic SQL rollback on code rollback. Bundle SQL strings into ${Artifact.workerPath}; loose public .sql files are not automatically run. These per-object SQL migrations are separate from Cloudflare class/namespace exports, which Ren manages.`,
  "Keep existing binding-to-class mappings unchanged. Data survives updates and stop/redeploy while provider storage is retained. WebSocket clients must reconnect after deployment. The manifest is publicly served; include no secrets.",
].join(" ")

const Files = Schema.Record(Schema.String, Schema.String).annotate({
  description: "UTF-8 file map keyed by relative path (for example index.html and assets/app.js).",
})

const Directory = Schema.String.annotate({
  description:
    "A folder on the environment to publish with every file in it, binary files included. A relative path starts at the chat’s folder. Pass files or directory, not both.",
})

const Entry = Schema.String.annotate({
  description: "Entry file path relative to the artifact root. Defaults to index.html, index.md, or the sole file.",
})

const Name = Artifact.Name.annotate({
  description:
    "Its own address: https://<name>.<artifact domain>/. 1 to 63 lowercase letters, digits and hyphens; unique across Ren.",
})

const CreateToolInput = Schema.Struct({
  title: Schema.String.annotate({ description: "Human-readable artifact title." }),
  name: Schema.optional(Name).annotate({ description: "Omit to get a name from the title." }),
  files: Schema.optional(Files),
  directory: Schema.optional(Directory),
  entry: Schema.optional(Entry),
})

const UpdateToolInput = Schema.Struct({
  id: Artifact.ID.annotate({ description: "Artifact ID (art_…) to update." }),
  baseDeploymentId: Schema.optional(Artifact.DeploymentID).annotate({
    description:
      "The deploymentId your change starts from: from your last artifact_read (publishedDeploymentId), artifact_create or artifact_update of this artifact. Omit it when publishedDeploymentId is null.",
  }),
  title: Schema.optional(Schema.String).annotate({ description: "Updated title, or omit to keep the current title." }),
  name: Schema.optional(Name).annotate({
    description: "A new name, or omit to keep the current one. The old name is free at once.",
  }),
  files: Schema.optional(Files.annotate({ description: "Replacement UTF-8 file map keyed by relative path." })),
  directory: Schema.optional(Directory),
  entry: Schema.optional(Entry.annotate({ description: "Updated entry file path." })),
})

const ReadToolInput = Schema.Struct({
  id: Artifact.ID.annotate({ description: "Artifact ID (art_…) to read." }),
  directory: Schema.optional(
    Schema.String.annotate({
      description:
        "A folder on the environment that does not exist yet. Every file of the artifact goes there, binary files included, ready to change and publish again with directory.",
    }),
  ),
})

const DeleteToolInput = Schema.Struct({
  id: Artifact.ID.annotate({ description: "Artifact ID (art_…) to delete." }),
})

const Published = Schema.Struct({
  id: Artifact.ID,
  provider: Schema.Literal(providerId),
  deploymentId: Artifact.DeploymentID,
  status: Artifact.Status,
  url: Schema.NullOr(Schema.String),
  message: Schema.String,
})

const Content = Schema.Struct({
  info: Artifact.Info,
  directory: Schema.optional(Schema.String.annotate({ description: "The folder that now holds every file." })),
})

const Deleted = Schema.Struct({ id: Artifact.ID, status: Artifact.Status })

class Unreachable extends Schema.TaggedError<Unreachable>()("OpenCodeArtifacts.Unreachable", {
  message: Schema.String,
}) {}

const messageOf = (error: unknown) =>
  Predicate.hasProperty(error, "message") && Predicate.isString(error.message) && error.message
    ? error.message
    : String(error)

const failure = (error: unknown) => new Tool.Error({ message: messageOf(error), error })

export const make = (input: {
  readonly ren: OpenCodeMcp.RenAccess
  readonly connections: Option.Option<HandConnections.Interface>
  readonly directoryOf: (sessionId: string) => string
}) =>
  Plugin.define({
    id: "ren.artifact",
    effect: (context) =>
      Effect.gen(function* () {
        const workspaceID = context.location.workspaceID
        const folder = context.location.directory
        const session = RenPlugin.sessionOf(context.location, input.directoryOf)
        if (!session.isSession) return
        const sessionId = session.sessionId
        const ren = input.ren
        const call = <A, E>(
          id: string,
          use: (client: HttpApiClient.ForApi<typeof RenHostApi>, id: Artifact.ID) => Effect.Effect<A, E>,
        ) =>
          Effect.gen(function* () {
            const artifactId = yield* Schema.decodeUnknownEffect(Artifact.ID)(id)
            const address = yield* ren.address
            const token = yield* ren.token
            if (Option.isNone(address) || Option.isNone(token))
              return yield* new Unreachable({ message: "This brain cannot reach Ren to publish artifacts" })
            const client = yield* HostToken.client(address.value)
            return yield* use(client, artifactId).pipe(HostToken.withToken(token.value))
          }).pipe(
            Effect.retry({ times: 2, while: HttpClientError.isHttpClientError }),
            Effect.timeout(answersWithin),
            Effect.provide(FetchHttpClient.layer),
          )
        const onEnvironment = <A, E>(use: (client: HandClient.Client) => Effect.Effect<A, E>) =>
          Effect.gen(function* () {
            const connections = Option.filter(input.connections, () => Boolean(workspaceID))
            if (Option.isNone(connections))
              return yield* new Tool.Error({
                message: "This chat has no environment, so it has no folder to publish or read into.",
              })
            return yield* connections.value.connect(Session.ID.make(sessionId)).pipe(
              Effect.flatMap((connection) => use(connection.client)),
              Effect.scoped,
            )
          })

        const publish = (
          id: Artifact.ID,
          source: {
            readonly title?: string | undefined
            readonly name?: Artifact.Name | undefined
            readonly entry?: string | undefined
            readonly baseDeploymentId?: Artifact.DeploymentID | undefined
            readonly files?: Readonly<Record<string, string>> | undefined
            readonly directory?: string | undefined
          },
        ) =>
          Effect.gen(function* () {
            if (Predicate.isUndefined(source.files) === Predicate.isUndefined(source.directory))
              return yield* new Tool.Error({ message: "Pass either files or directory." })
            const upload = yield* call(id, (client, artifactId) =>
              client.artifacts["artifacts.upload"]({ params: { id: artifactId } }),
            )
            const directory = source.directory
            if (Predicate.isNotUndefined(directory))
              yield* onEnvironment((client) =>
                client["files.pack"]({
                  path: resolve(folder, directory),
                  url: upload.url,
                  maxBytes: Artifact.maxTotalBytes,
                  maxFiles: Artifact.maxFiles,
                  maxFileBytes: Artifact.maxFileBytes,
                }),
              ).pipe(
                Effect.catchTags({
                  FileNotFoundError: () => Effect.fail(new Tool.Error({ message: `${directory} does not exist.` })),
                  WrongKindError: () => Effect.fail(new Tool.Error({ message: `${directory} is not a folder.` })),
                }),
              )
            else {
              const body = yield* Tar.gzip("artifact", source.files ?? {})
              const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
              yield* http
                .execute(HttpClientRequest.put(upload.url).pipe(HttpClientRequest.bodyUint8Array(body)))
                .pipe(
                  Effect.retry({ times: 2, while: HttpClientError.isHttpClientError }),
                  Effect.timeout(answersWithin),
                )
            }
            const deploymentId = Artifact.DeploymentID.make(crypto.randomUUID())
            const info = yield* call(id, (client, artifactId) =>
              client.artifacts["artifacts.deploy"]({
                params: { id: artifactId },
                payload: {
                  deploymentId,
                  uploadId: upload.uploadId,
                  ...(Predicate.isNotUndefined(source.title) && { title: source.title.trim() }),
                  ...(Predicate.isNotUndefined(source.name) && { name: source.name }),
                  ...(Predicate.isNotUndefined(source.entry) && { entry: source.entry.replace(/^(?:\.\/)+/u, "") }),
                  ...(source.baseDeploymentId && { baseDeploymentId: source.baseDeploymentId }),
                  sessionId: Session.ID.make(sessionId),
                },
              }),
            )
            return {
              output: {
                id: info.artifactId,
                provider: providerId,
                deploymentId: info.deploymentId,
                status: info.status,
                url: info.url,
                message:
                  "Deployment accepted. It runs in the background; this result does not mean the app is live. Ren sends the result to this chat when it ends. Continue other work.",
              } as const,
            }
          }).pipe(Effect.provide(FetchHttpClient.layer), Effect.mapError(failure))

        yield* context.tool.transform((editor) => {
          const options = { namespace: "opencode", codemode: true } as const
          editor.add({
            name: "artifact_create",
            description: `Publish a new artifact with Ren. ${prompt}`,
            input: CreateToolInput,
            output: Published,
            options,
            execute: (args) => publish(Artifact.ID.make(`art_${Identifier.ascending()}`), args),
          })
          editor.add({
            name: "artifact_update",
            description:
              "Replace an existing artifact’s files at the same ID and URL, from files or a directory. Find the space’s artifacts and their ids with Ren’s artifact_list tool.",
            input: UpdateToolInput,
            output: Published,
            options,
            execute: (args) => publish(args.id, args),
          })
          editor.add({
            name: "artifact_read",
            description:
              "Read an artifact’s title, entry, URL and publishedDeploymentId, the base for your next artifact_update. Pass directory to get its last published files, binary files included, as a folder to change and publish again. Find the space’s artifacts and their ids with Ren’s artifact_list tool.",
            input: ReadToolInput,
            output: Content,
            options,
            execute: (args) =>
              Effect.gen(function* () {
                const info = yield* call(args.id, (client, id) =>
                  client.artifacts["artifacts.read"]({ params: { id } }),
                )
                const directory = args.directory
                if (Predicate.isUndefined(directory)) return { output: { info } }
                const path = resolve(folder, directory)
                const archive = yield* call(args.id, (client, id) =>
                  client.artifacts["artifacts.download"]({ params: { id } }),
                )
                yield* onEnvironment((client) =>
                  Effect.gen(function* () {
                    const found = yield* client["files.stat"]({ path }).pipe(Effect.option)
                    if (Option.isSome(found))
                      return yield* new Tool.Error({ message: `${directory} exists. Name a folder that does not.` })
                    yield* client["files.unpack"]({
                      url: archive.url,
                      folder: ".",
                      path,
                      maxBytes: Artifact.maxTotalBytes,
                      maxFiles: Artifact.maxFiles,
                    })
                  }),
                )
                return { output: { info, directory: path } }
              }).pipe(Effect.mapError(failure)),
          })
          editor.add({
            name: "artifact_delete",
            description:
              "Stop serving an artifact. The stop runs in the background, and Ren sends its result to this chat. Ren keeps the artifact’s files and application data, and publishing it again serves it at the same URL.",
            input: DeleteToolInput,
            output: Deleted,
            options,
            execute: (args) =>
              call(args.id, (client, id) =>
                client.artifacts["artifacts.stop"]({
                  params: { id },
                  query: { sessionId: Session.ID.make(sessionId) },
                }),
              ).pipe(
                Effect.map((stop) => ({ output: { id: args.id, status: stop.status } })),
                Effect.mapError(failure),
              ),
          })
          editor.add({
            name: "artifact_status",
            description:
              "Read the status of one deployment or stop of an artifact. Ren sends each result to the chat that asked, so use this only when that message is missing. Ready includes its URL; failed includes its error.",
            input: Schema.Struct({ id: Artifact.ID, deploymentId: Artifact.DeploymentID }),
            output: Artifact.Deployment,
            options,
            execute: (args) =>
              call(args.id, (client, id) =>
                client.artifacts["artifacts.status"]({ params: { id, deploymentId: args.deploymentId } }),
              ).pipe(
                Effect.map((output) => ({ output })),
                Effect.mapError(failure),
              ),
          })
        })
      }),
  })
