export * as Artifacts from "./artifacts.js"

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { Database } from "@ren/db/database"
import { Artifact } from "@ren/schema/artifact"
import { Auth } from "@ren/schema/auth"
import { Space } from "@ren/schema/space"
import { and, count, desc, eq, isNull, sql } from "drizzle-orm"
import { Cause, Context, DateTime, Duration, Effect, Exit, Layer, Option, Predicate, Schedule, Schema } from "effect"
import { ClusterSchema, EntityAddress, EntityId, EntityType, MessageStorage, Sharding } from "effect/cluster"
import { Workflow, WorkflowEngine } from "effect/workflow"
import { Access } from "./access.js"
import { Actor } from "./actor.js"
import { ArtifactProvider } from "./artifact-provider.js"
import { ArtifactArchive } from "./artifact-archive.js"
import { ArtifactPolicy } from "./artifact/policy.js"
import { DurableRunner } from "./durable-runner.js"
import { ObjectStorage } from "./object-storage.js"
import { Primitive } from "./primitive.js"

export class Failed extends Schema.TaggedError<Failed>()("Artifacts.Failed", { message: Schema.String }) {}

export interface Owner {
  readonly organizationId: Auth.OrganizationID
  readonly spaceId: Space.ID
}

export type Interface = Primitive.Interface<typeof Artifact.definition> & {
  readonly upload: (owner: Owner, id: Artifact.ID) => Effect.Effect<Artifact.Upload, Primitive.Conflict | Failed>
  readonly deploy: (
    owner: Owner,
    id: Artifact.ID,
    input: Artifact.DeployInput,
  ) => Effect.Effect<Artifact.Deployment, Primitive.Conflict | Primitive.Invalid | Failed>
  readonly status: (
    owner: Owner,
    id: Artifact.ID,
    deploymentId: Artifact.DeploymentID,
  ) => Effect.Effect<Artifact.Deployment, Primitive.NotFound>
  readonly read: (owner: Owner, id: Artifact.ID) => Effect.Effect<Artifact.Info, Primitive.NotFound>
  readonly download: (owner: Owner, id: Artifact.ID) => Effect.Effect<Artifact.Archive, Primitive.NotFound | Failed>
  readonly stop: (owner: Owner, id: Artifact.ID) => Effect.Effect<void, Failed>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Artifacts") {}

export const DeployRun = Workflow.make("ArtifactDeploy", {
  payload: {
    id: Artifact.ID,
    deploymentId: Artifact.DeploymentID,
    organizationId: Auth.OrganizationID,
    title: Artifact.Info.fields.title,
    config: Artifact.Config,
    codeArchive: Schema.String,
  },
  success: Schema.Struct({ deployment: Artifact.Deployment, binding: Schema.NullOr(Schema.Json) }),
  idempotencyKey: (payload) => `${payload.id}:${payload.deploymentId}`,
})

export const StopRun = DurableRunner.make("ArtifactStop", {
  payload: {
    id: Artifact.ID,
    deploymentId: Artifact.DeploymentID,
    stopId: Schema.optional(Artifact.DeploymentID),
    targetDeploymentId: Schema.optional(Artifact.DeploymentID),
  },
  idempotencyKey: (payload) => `${payload.id}:${payload.deploymentId}`,
})

export const SettleRun = DurableRunner.make("ArtifactSettle", {
  payload: {
    id: Artifact.ID,
    claimId: Artifact.DeploymentID,
    executionId: Schema.String,
    kind: Schema.Literals(["deploy", "stop"]),
  },
  idempotencyKey: (payload) => `${payload.id}:${payload.claimId}`,
})

const Manifest = Schema.fromJsonString(Schema.Struct({ durableObjects: Schema.optional(Artifact.DurableObjects) }))

const configOf = Effect.fnUntraced(function* (
  files: Artifact.Files,
  entry: string | undefined,
  current: string | undefined,
) {
  const paths = Object.keys(files)
  const chosen =
    entry ??
    [current, "index.html", "index.md"].find((path) => Predicate.isNotUndefined(path) && Object.hasOwn(files, path)) ??
    (paths.length === 1 ? paths.at(0) : undefined)
  if (!chosen)
    return yield* new Primitive.Invalid({
      message: "Include index.html or index.md, or name the entry when you publish several files.",
      field: "entry",
    })
  if (!Object.hasOwn(files, chosen))
    return yield* new Primitive.Invalid({ message: `The entry ${chosen} is not one of the files.`, field: "entry" })
  const manifest = files[Artifact.manifestPath]
  const durableObjects = manifest
    ? (yield* Schema.decodeUnknownEffect(Manifest)(new TextDecoder().decode(manifest)).pipe(
        Effect.mapError(
          (error) =>
            new Primitive.Invalid({
              message: `${Artifact.manifestPath} is not valid: ${error.message}`,
              field: "uploadId",
            }),
        ),
      )).durableObjects
    : undefined
  if (Object.keys(durableObjects ?? {}).length && !Object.hasOwn(files, Artifact.workerPath))
    return yield* new Primitive.Invalid({
      message: `Durable Objects need ${Artifact.workerPath} with their exported classes.`,
      field: "uploadId",
    })
  return { entry: chosen, ...(durableObjects && { durableObjects }) } satisfies Artifact.Config
})

export const deployWithin = Duration.minutes(2)

export const linkLifetime = Duration.minutes(15)

const uploadsPrefix = "artifact-uploads/"
const artifacts = Database.Schema.artifact

type Row = typeof artifacts.$inferSelect

const ownedBy = (row: Row, owner: Owner) =>
  row.space_id === owner.spaceId && row.organization_id === owner.organizationId

const storedConfig = (row: Row): Artifact.Config => row.config ?? { entry: "index.html" }

const notFound = new Primitive.NotFound({ message: "Artifact not found." })

const isID = Schema.is(Artifact.ID)

const archivedConflict = (id: Artifact.ID) =>
  new Primitive.Conflict({ message: `Artifact ${id} is archived. Publish a new artifact instead.` })

const owned = (found: Row | undefined, owner: Owner) =>
  found && !ownedBy(found, owner)
    ? Effect.fail(new Primitive.Conflict({ message: `Artifact ${found.id} belongs to another space` }))
    : Effect.void

const unarchived = (found: Row | undefined) =>
  found?.archived_at ? Effect.fail(archivedConflict(found.id)) : Effect.void

const actions = {
  get: Primitive.action(Artifact.definition, "get"),
  archive: Primitive.action(Artifact.definition, "archive"),
}

const membershipOf = (actor: Actor.Info) =>
  and(
    eq(ArtifactPolicy.membership.space_id, artifacts.space_id),
    eq(ArtifactPolicy.membership.user_id, actor.userId),
    isNull(ArtifactPolicy.membership.archived_at),
    Actor.fenced(actor, ArtifactPolicy.membership.space_id),
  )

const toInfo = (row: Row): Artifact.Info => ({
  id: row.id,
  spaceId: row.space_id,
  title: row.title,
  entry: row.config?.entry ?? null,
  url: row.url,
  pendingDeploymentId: row.pending_deployment_id,
  publishedDeploymentId: row.published_deployment_id,
  createdAt: DateTime.fromDateUnsafe(row.created_at),
  updatedAt: DateTime.fromDateUnsafe(row.updated_at),
  archivedAt: row.archived_at && DateTime.fromDateUnsafe(row.archived_at),
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service
    const provider = yield* ArtifactProvider.Service
    const storage = yield* ObjectStorage.Service
    const signer = yield* Effect.acquireRelease(
      Effect.sync(
        () =>
          new S3Client({
            ...storage.client,
            forcePathStyle: Option.isSome(storage.endpoint),
            requestChecksumCalculation: "WHEN_REQUIRED",
          }),
      ),
      (client) => Effect.sync(() => client.destroy()),
    )
    const engine = yield* WorkflowEngine.WorkflowEngine
    const messages = yield* MessageStorage.MessageStorage
    const sharding = yield* Sharding.Sharding

    const store = <A>(run: (signal: AbortSignal) => Promise<A>) =>
      Effect.tryPromise({
        try: run,
        catch: (cause) => new Failed({ message: `Ren could not reach its storage: ${String(cause)}` }),
      })

    const requested = Effect.fnUntraced(function* (run: Workflow.Any, executionId: string) {
      const entityId = EntityId.make(executionId)
      const group = Context.get(run.annotations, ClusterSchema.ShardGroup)(entityId)
      const address = EntityAddress.make({
        entityType: EntityType.make(`Workflow/${run._tag}`),
        entityId,
        shardId: sharding.getShardId(entityId, group),
      })
      return Option.isSome(yield* messages.requestIdForPrimaryKey({ address, tag: "run", id: "" }).pipe(Effect.orDie))
    })

    yield* DurableRunner.register(SettleRun, (payload) =>
      Effect.gen(function* () {
        yield* (
          payload.kind === "deploy"
            ? engine
                .poll(DeployRun, payload.executionId)
                .pipe(Effect.map((result) => Option.isSome(result) && result.value._tag === "Complete"))
            : engine
                .poll(StopRun, payload.executionId)
                .pipe(Effect.map((result) => Option.isSome(result) && result.value._tag === "Complete"))
        ).pipe(Effect.repeat({ schedule: Schedule.spaced("50 millis"), until: (complete) => complete }))
        yield* database.db
          .update(artifacts)
          .set({ pending_deployment_id: null, updated_at: sql`now()` })
          .where(and(eq(artifacts.id, payload.id), eq(artifacts.pending_deployment_id, payload.claimId)))
          .pipe(Effect.orDie)
      }).pipe(
        Effect.sandbox,
        Effect.retry({ schedule: DurableRunner.retry, while: (cause) => !Cause.hasInterrupts(cause) }),
        Effect.catch(Effect.failCause),
      ),
    )

    yield* engine.register(DeployRun, (payload) =>
      Effect.gen(function* () {
        const result = (status: Artifact.Status, url: string | null, error: string | null): Artifact.Deployment => ({
          artifactId: payload.id,
          deploymentId: payload.deploymentId,
          status,
          url,
          error,
        })
        const row = (yield* database.db
          .select()
          .from(artifacts)
          .where(eq(artifacts.id, payload.id))
          .pipe(Effect.orDie)).at(0)
        if (!row || row.pending_deployment_id !== payload.deploymentId)
          return { deployment: result("stopped", null, null), binding: null }
        if (row.provider !== provider.id)
          return {
            deployment: result("failed", row.url, "This deployment belongs to another artifact provider"),
            binding: null,
          }
        const current = and(eq(artifacts.id, payload.id), eq(artifacts.pending_deployment_id, payload.deploymentId))
        return yield* Effect.gen(function* () {
          const deployed = yield* provider
            .deploy({
              artifactId: payload.id,
              deploymentId: payload.deploymentId,
              config: payload.config,
              archive: payload.codeArchive,
              previous: Option.fromNullishOr(row.remote),
            })
            .pipe(
              Effect.timeoutOrElse({
                duration: deployWithin,
                orElse: () => Effect.fail(new ArtifactProvider.Failed({ message: "The deployment timed out" })),
              }),
            )
          yield* database.db
            .update(artifacts)
            .set({
              title: payload.title,
              config: payload.config,
              code_archive: payload.codeArchive,
              remote: deployed.binding,
              url: deployed.url,
              published_deployment_id: payload.deploymentId,
              updated_at: sql`now()`,
            })
            .where(current)
            .pipe(Effect.orDie)
          return { deployment: result("ready", deployed.url, null), binding: deployed.binding }
        }).pipe(
          Effect.catch((error) =>
            Effect.succeed({ deployment: result("failed", row.url, error.message), binding: null }),
          ),
        )
      }).pipe(
        Effect.sandbox,
        Effect.retry({ schedule: DurableRunner.retry, while: (cause) => !Cause.hasInterrupts(cause) }),
        Effect.catch(Effect.failCause),
      ),
    )

    yield* DurableRunner.register(StopRun, (payload) =>
      Effect.gen(function* () {
        const initial = (yield* database.db
          .select()
          .from(artifacts)
          .where(eq(artifacts.id, payload.id))
          .pipe(Effect.orDie)).at(0)
        const claimId = payload.stopId ?? payload.deploymentId
        if (!initial || initial.pending_deployment_id !== claimId) return
        const completed = yield* Effect.gen(function* () {
          if (!payload.targetDeploymentId) return Option.none()
          const executionId = yield* DeployRun.executionId({
            id: payload.id,
            deploymentId: payload.targetDeploymentId,
            organizationId: initial.organization_id,
            title: initial.title,
            config: storedConfig(initial),
            codeArchive: initial.code_archive ?? "",
          })
          yield* engine.interruptUnsafe(DeployRun, executionId)
          return yield* engine.poll(DeployRun, executionId).pipe(
            Effect.repeat({
              schedule: Schedule.spaced("50 millis"),
              until: (result) => Option.isSome(result) && result.value._tag === "Complete",
            }),
          )
        })
        const row = (yield* database.db
          .select()
          .from(artifacts)
          .where(eq(artifacts.id, payload.id))
          .pipe(Effect.orDie)).at(0)
        if (!row || row.pending_deployment_id !== claimId) return
        if (row.provider !== provider.id)
          return yield* Effect.die(new Error("Restore this artifact's original provider to finish stopping it"))
        const binding =
          Option.isSome(completed) && completed.value._tag === "Complete" && Exit.isSuccess(completed.value.exit)
            ? (completed.value.exit.value.binding ?? row.remote)
            : row.remote
        yield* provider.stop(payload.id, Option.fromNullishOr(binding))
        yield* database.db
          .update(artifacts)
          .set({ remote: null, url: null, updated_at: sql`now()` })
          .where(and(eq(artifacts.id, payload.id), eq(artifacts.pending_deployment_id, claimId)))
          .pipe(Effect.orDie)
      }).pipe(
        Effect.sandbox,
        Effect.retry({ schedule: DurableRunner.retry, while: (cause) => !Cause.hasInterrupts(cause) }),
        Effect.catch(Effect.failCause),
        Effect.orDie,
      ),
    )

    const status = Effect.fn("Artifacts.status")(function* (
      owner: Owner,
      id: Artifact.ID,
      deploymentId: Artifact.DeploymentID,
    ) {
      const row = (yield* database.db.select().from(artifacts).where(eq(artifacts.id, id)).pipe(Effect.orDie)).at(0)
      if (!row || !ownedBy(row, owner))
        return yield* new Primitive.NotFound({ message: `Artifact ${id} does not exist` })
      const executionId = yield* DeployRun.executionId({
        id,
        deploymentId,
        organizationId: owner.organizationId,
        title: row.title,
        config: storedConfig(row),
        codeArchive: row.code_archive ?? "",
      })
      const completed = Option.filter(
        yield* engine.poll(DeployRun, executionId),
        (result) => result._tag === "Complete",
      )
      const stopId = yield* StopRun.executionId({ id, deploymentId })
      if (yield* requested(StopRun, stopId)) {
        const cleanup = yield* engine.poll(StopRun, stopId)
        return {
          artifactId: id,
          deploymentId,
          status:
            Option.isSome(cleanup) && cleanup.value._tag === "Complete" && Exit.isSuccess(cleanup.value.exit)
              ? ("stopped" as const)
              : ("deploying" as const),
          url: null,
          error: null,
        }
      }
      if (Option.isSome(completed) && row.pending_deployment_id !== deploymentId) {
        if (Exit.isSuccess(completed.value.exit)) return completed.value.exit.value.deployment
        return {
          artifactId: id,
          deploymentId,
          status: "failed" as const,
          url: row.url,
          error: "The deployment workflow failed",
        }
      }
      if (!(yield* requested(DeployRun, executionId)))
        return yield* new Primitive.NotFound({ message: `Deployment ${deploymentId} does not exist` })
      return { artifactId: id, deploymentId, status: "deploying" as const, url: row.url, error: null }
    })

    const uploadKey = (owner: Owner, id: Artifact.ID, uploadId: Artifact.UploadID) =>
      `${uploadsPrefix}${owner.organizationId}/${id}/${uploadId}.tar.gz`

    const link = Effect.fnUntraced(function* (command: PutObjectCommand | GetObjectCommand) {
      const expiresAt = DateTime.addDuration(yield* DateTime.now, linkLifetime)
      const url = yield* store(() => getSignedUrl(signer, command, { expiresIn: Duration.toSeconds(linkLifetime) }))
      return { url, expiresAt }
    })

    const visibleTo = (actor: Actor.Info) =>
      and(
        eq(artifacts.organization_id, actor.organizationId),
        isNull(artifacts.archived_at),
        Access.where(access.plan(actor, actions.get), ArtifactPolicy.where),
      )

    const claimStop = Effect.fnUntraced(function* (transaction: Database.Transaction, row: Row) {
      if (row.provider !== provider.id)
        return yield* new Failed({
          message: `Artifact ${row.id} runs on another provider; stop it using its original provider`,
        })
      if (row.pending_deployment_id) {
        const executionId = yield* DeployRun.executionId({
          id: row.id,
          deploymentId: row.pending_deployment_id,
          organizationId: row.organization_id,
          title: row.title,
          config: storedConfig(row),
          codeArchive: row.code_archive ?? "",
        })
        if (!(yield* requested(DeployRun, executionId))) return { claimId: row.pending_deployment_id, settlement: null }
      } else if (!row.remote && !row.url) return
      const stopId = Artifact.DeploymentID.make(crypto.randomUUID())
      const payload = {
        id: row.id,
        deploymentId: row.pending_deployment_id ?? stopId,
        stopId,
        ...(row.pending_deployment_id ? { targetDeploymentId: row.pending_deployment_id } : {}),
      }
      const executionId = yield* StopRun.executionId(payload)
      yield* transaction
        .update(artifacts)
        .set({ pending_deployment_id: stopId, updated_at: sql`now()` })
        .where(eq(artifacts.id, row.id))
      yield* StopRun.execute(payload, { discard: true }).pipe(
        Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
      )
      const settlement = { id: row.id, claimId: stopId, executionId, kind: "stop" as const }
      yield* SettleRun.execute(settlement, { discard: true }).pipe(
        Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
      )
      return { claimId: stopId, settlement }
    })

    const stopped = Effect.fnUntraced(function* (
      id: Artifact.ID,
      pending: Effect.Success<ReturnType<typeof claimStop>>,
    ) {
      if (!pending) return
      if (pending.settlement) {
        yield* SettleRun.execute(pending.settlement).pipe(Effect.provideService(WorkflowEngine.WorkflowEngine, engine))
        return
      }
      yield* database.db
        .select({ active: artifacts.pending_deployment_id })
        .from(artifacts)
        .where(eq(artifacts.id, id))
        .pipe(
          Effect.orDie,
          Effect.repeat({
            schedule: Schedule.spaced("50 millis"),
            until: (rows) => rows.at(0)?.active !== pending.claimId,
          }),
        )
    })

    return Service.of({
      list: Effect.fn("Artifacts.list")(function* (actor: Actor.Info, input: Artifact.ListInput) {
        const where = and(visibleTo(actor), input.spaceId ? eq(artifacts.space_id, input.spaceId) : undefined)
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const rows = yield* transaction
              .select({ artifact: artifacts })
              .from(artifacts)
              .leftJoin(ArtifactPolicy.membership, membershipOf(actor))
              .where(where)
              .orderBy(desc(artifacts.created_at), desc(artifacts.id))
              .limit(input.pageSize)
              .offset((input.page - 1) * input.pageSize)
            const totals = yield* transaction
              .select({ total: count() })
              .from(artifacts)
              .leftJoin(ArtifactPolicy.membership, membershipOf(actor))
              .where(where)
            return {
              items: rows.map((row) => toInfo(row.artifact)),
              page: input.page,
              pageSize: input.pageSize,
              total: totals.at(0)?.total ?? 0,
            }
          }),
        )
      }),
      get: Effect.fn("Artifacts.get")(function* (actor: Actor.Info, idOrSlug: string) {
        if (!isID(idOrSlug)) return yield* notFound
        const found = (yield* database.db
          .select({ artifact: artifacts })
          .from(artifacts)
          .leftJoin(ArtifactPolicy.membership, membershipOf(actor))
          .where(and(eq(artifacts.id, idOrSlug), visibleTo(actor)))
          .pipe(Effect.orDie)).at(0)
        if (!found) return yield* notFound
        return toInfo(found.artifact)
      }),
      archive: Effect.fn("Artifacts.archive")(function* (actor: Actor.Info, id: Artifact.ID) {
        const pending = yield* database
          .transaction((transaction) =>
            Effect.gen(function* () {
              const found = (yield* transaction
                .select({ artifact: artifacts, membershipId: ArtifactPolicy.membership.id })
                .from(artifacts)
                .leftJoin(ArtifactPolicy.membership, membershipOf(actor))
                .where(and(eq(artifacts.id, id), visibleTo(actor)))
                .for("update", { of: artifacts })).at(0)
              if (!found) return yield* notFound
              if (
                !access.isAllowed({
                  actor,
                  action: actions.archive,
                  resource: ArtifactPolicy.resource(found.membershipId),
                })
              )
                return yield* new Primitive.Forbidden({ message: "You cannot archive this artifact." })
              yield* transaction
                .update(artifacts)
                .set({ archived_at: sql`now()`, updated_at: sql`now()` })
                .where(eq(artifacts.id, id))
              return yield* claimStop(transaction, found.artifact)
            }),
          )
          .pipe(
            Effect.catchTag("Artifacts.Failed", (error) =>
              Effect.fail(new Primitive.Conflict({ message: error.message })),
            ),
          )
        yield* stopped(id, pending).pipe(Effect.orDie)
        const row = (yield* database.db.select().from(artifacts).where(eq(artifacts.id, id)).pipe(Effect.orDie)).at(0)
        if (!row) return yield* notFound
        return toInfo(row)
      }),
      upload: Effect.fn("Artifacts.upload")(function* (owner, id) {
        const found = (yield* database.db.select().from(artifacts).where(eq(artifacts.id, id)).pipe(Effect.orDie)).at(0)
        yield* owned(found, owner)
        yield* unarchived(found)
        const uploadId = Artifact.UploadID.make(crypto.randomUUID())
        const signed = yield* link(
          new PutObjectCommand({ Bucket: storage.bucket, Key: uploadKey(owner, id, uploadId) }),
        )
        return { uploadId, ...signed }
      }),
      download: Effect.fn("Artifacts.download")(function* (owner, id) {
        const row = (yield* database.db.select().from(artifacts).where(eq(artifacts.id, id)).pipe(Effect.orDie)).at(0)
        if (!row || !ownedBy(row, owner) || !row.code_archive)
          return yield* new Primitive.NotFound({ message: `Artifact ${id} does not exist` })
        return yield* link(new GetObjectCommand({ Bucket: storage.bucket, Key: row.code_archive }))
      }),
      deploy: Effect.fn("Artifacts.deploy")(function* (owner, id, input) {
        const codeArchive = `${owner.organizationId}/artifacts/${id}/deployments/${input.deploymentId}/${input.uploadId}.tar.gz`
        const found = (yield* database.db.select().from(artifacts).where(eq(artifacts.id, id)).pipe(Effect.orDie)).at(0)
        yield* owned(found, owner)
        const title = input.title ?? found?.title
        if (!title) return yield* new Primitive.Invalid({ message: "A new artifact needs a title.", field: "title" })
        if (
          found &&
          (yield* requested(
            DeployRun,
            yield* DeployRun.executionId({
              id,
              deploymentId: input.deploymentId,
              organizationId: owner.organizationId,
              title: found.title,
              config: storedConfig(found),
              codeArchive,
            }),
          ))
        )
          return yield* status(owner, id, input.deploymentId).pipe(Effect.orDie)
        if (found?.pending_deployment_id === input.deploymentId)
          return yield* status(owner, id, input.deploymentId).pipe(Effect.orDie)
        yield* unarchived(found)
        const uploaded = uploadKey(owner, id, input.uploadId)
        const source = yield* ArtifactArchive.read(storage, uploaded).pipe(
          Effect.catchTags({
            "ArtifactArchive.Invalid": (error) =>
              Effect.fail(new Primitive.Invalid({ message: error.message, field: "uploadId" })),
            "ArtifactArchive.Failed": (error) => Effect.fail(new Failed({ message: error.message })),
          }),
        )
        const config = yield* configOf(source.files, input.entry, found?.config?.entry)
        yield* Effect.tryPromise({
          try: (signal) =>
            storage.s3.send(
              new CopyObjectCommand({
                Bucket: storage.bucket,
                Key: codeArchive,
                CopySource: `${storage.bucket}/${uploaded.split("/").map(encodeURIComponent).join("/")}`,
                CopySourceIfMatch: source.version,
              }),
              { abortSignal: signal },
            ),
          catch: (cause) => cause,
        }).pipe(
          Effect.catch((cause) =>
            Effect.gen(function* () {
              if (cause instanceof S3ServiceException && ["NoSuchKey", "PreconditionFailed"].includes(cause.name))
                return yield* new Primitive.Invalid({
                  message: "The upload changed while Ren checked it. Upload the archive again.",
                  field: "uploadId",
                })
              yield* Effect.logWarning("Ren could not copy an artifact upload", cause)
              return yield* new Failed({ message: "Ren could not copy the upload" })
            }),
          ),
        )
        const payload = {
          id,
          deploymentId: input.deploymentId,
          organizationId: owner.organizationId,
          title,
          config,
          codeArchive,
        }
        const executionId = yield* DeployRun.executionId(payload)
        yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* transaction
              .insert(artifacts)
              .values({
                id,
                organization_id: owner.organizationId,
                space_id: owner.spaceId,
                title,
                config,
                provider: provider.id,
                code_archive: codeArchive,
              })
              .onConflictDoNothing()
            const row = (yield* transaction.select().from(artifacts).where(eq(artifacts.id, id)).for("update")).at(0)
            if (!row || !ownedBy(row, owner))
              return yield* new Primitive.Conflict({ message: `Artifact ${id} belongs to another space` })
            if (row.provider !== provider.id)
              return yield* new Primitive.Conflict({ message: `Artifact ${id} runs on another provider` })
            if (yield* requested(DeployRun, executionId)) return
            if (row.pending_deployment_id === input.deploymentId) return
            if (row.archived_at) return yield* archivedConflict(id)
            if (row.pending_deployment_id)
              return yield* new Primitive.Conflict({ message: `Artifact ${id} has active deployment work` })
            yield* transaction
              .update(artifacts)
              .set({ pending_deployment_id: input.deploymentId, updated_at: sql`now()` })
              .where(eq(artifacts.id, id))
            yield* DeployRun.execute(payload, { discard: true }).pipe(
              Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
            )
            yield* SettleRun.execute(
              { id, claimId: input.deploymentId, executionId, kind: "deploy" },
              { discard: true },
            ).pipe(Effect.provideService(WorkflowEngine.WorkflowEngine, engine))
          }),
        )
        yield* store((signal) =>
          storage.s3.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: uploaded }), { abortSignal: signal }),
        ).pipe(Effect.ignore)
        return yield* status(owner, id, input.deploymentId).pipe(Effect.orDie)
      }),
      status,
      read: Effect.fn("Artifacts.read")(function* (owner, id) {
        const row = (yield* database.db.select().from(artifacts).where(eq(artifacts.id, id)).pipe(Effect.orDie)).at(0)
        if (!row || !ownedBy(row, owner))
          return yield* new Primitive.NotFound({ message: `Artifact ${id} does not exist` })
        return toInfo(row)
      }),
      stop: Effect.fn("Artifacts.stop")(function* (owner, id) {
        const pending = yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const row = (yield* transaction.select().from(artifacts).where(eq(artifacts.id, id)).for("update")).at(0)
            if (!row || !ownedBy(row, owner)) return
            return yield* claimStop(transaction, row)
          }),
        )
        yield* stopped(id, pending)
      }),
    })
  }),
).pipe(Layer.provide(ObjectStorage.layer))
