export * as Artifacts from "./artifacts.js"

import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { Database } from "@ren/db/database"
import { Artifact } from "@ren/schema/artifact"
import { Auth } from "@ren/schema/auth"
import { Space } from "@ren/schema/space"
import { and, eq, sql } from "drizzle-orm"
import { Cause, Context, Duration, Effect, Exit, Layer, Option, Schedule, Schema } from "effect"
import { ClusterSchema, EntityAddress, EntityId, EntityType, MessageStorage, Sharding } from "effect/cluster"
import { Workflow, WorkflowEngine } from "effect/workflow"
import { ArtifactProvider } from "./artifact-provider.js"
import { DurableRunner } from "./durable-runner.js"
import { ObjectStorage } from "./object-storage.js"
import { Primitive } from "./primitive.js"

export class Failed extends Schema.TaggedError<Failed>()("Artifacts.Failed", { message: Schema.String }) {}

export interface Owner {
  readonly organizationId: Auth.OrganizationID
  readonly spaceId: Space.ID
}

export interface Interface {
  readonly deploy: (
    owner: Owner,
    id: Artifact.ID,
    input: Artifact.DeployInput,
  ) => Effect.Effect<Artifact.Deployment, Primitive.Conflict | Failed>
  readonly status: (
    owner: Owner,
    id: Artifact.ID,
    deploymentId: Artifact.DeploymentID,
  ) => Effect.Effect<Artifact.Deployment, Primitive.NotFound>
  readonly files: (owner: Owner, id: Artifact.ID) => Effect.Effect<Artifact.Files, Primitive.NotFound | Failed>
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

export const deployWithin = Duration.minutes(2)
const artifacts = Database.Schema.artifact

const ownedBy = (row: typeof artifacts.$inferSelect, owner: Owner) =>
  row.space_id === owner.spaceId && row.organization_id === owner.organizationId

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const provider = yield* ArtifactProvider.Service
    const storage = yield* ObjectStorage.Service
    const engine = yield* WorkflowEngine.WorkflowEngine
    const messages = yield* MessageStorage.MessageStorage
    const sharding = yield* Sharding.Sharding

    const store = <A>(run: (signal: AbortSignal) => Promise<A>) =>
      Effect.tryPromise({
        try: run,
        catch: (cause) => new Failed({ message: `Ren could not reach its storage: ${String(cause)}` }),
      })

    const read = (key: string) =>
      store(async (signal) => {
        const object = await storage.s3.send(new GetObjectCommand({ Bucket: storage.bucket, Key: key }), {
          abortSignal: signal,
        })
        const archive = (await object.Body?.transformToByteArray()) ?? new Uint8Array()
        return Object.fromEntries(
          await Promise.all(
            [...(await new Bun.Archive(archive).files()).values()].map(
              async (file) => [file.name, await file.bytes()] as const,
            ),
          ),
        )
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
          .set({ active_deployment_id: null, updated_at: sql`now()` })
          .where(and(eq(artifacts.id, payload.id), eq(artifacts.active_deployment_id, payload.claimId)))
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
        if (!row || row.active_deployment_id !== payload.deploymentId)
          return { deployment: result("stopped", null, null), binding: null }
        const current = and(eq(artifacts.id, payload.id), eq(artifacts.active_deployment_id, payload.deploymentId))
        return yield* Effect.gen(function* () {
          const files = yield* read(payload.codeArchive)
          const deployed = yield* provider
            .deploy({
              artifactId: payload.id,
              deploymentId: payload.deploymentId,
              config: payload.config,
              files,
              previous: Option.fromNullishOr(row.binding),
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
              binding: deployed.binding,
              url: deployed.url,
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
        if (!initial || initial.active_deployment_id !== claimId) return
        const completed = yield* Effect.gen(function* () {
          if (!payload.targetDeploymentId) return Option.none()
          const executionId = yield* DeployRun.executionId({
            id: payload.id,
            deploymentId: payload.targetDeploymentId,
            organizationId: initial.organization_id,
            title: initial.title,
            config: initial.config,
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
        if (!row || row.active_deployment_id !== claimId) return
        const binding =
          Option.isSome(completed) && completed.value._tag === "Complete" && Exit.isSuccess(completed.value.exit)
            ? (completed.value.exit.value.binding ?? row.binding)
            : row.binding
        yield* provider.stop(payload.id, Option.fromNullishOr(binding))
        yield* database.db
          .update(artifacts)
          .set({ binding: null, url: null, updated_at: sql`now()` })
          .where(and(eq(artifacts.id, payload.id), eq(artifacts.active_deployment_id, claimId)))
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
        config: row.config,
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
      if (Option.isSome(completed) && row.active_deployment_id !== deploymentId) {
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

    return Service.of({
      deploy: Effect.fn("Artifacts.deploy")(function* (owner, id, input) {
        const codeArchive = `${owner.organizationId}/artifacts/${id}/${input.deploymentId}/${crypto.randomUUID()}.tar.gz`
        const payload = {
          id,
          deploymentId: input.deploymentId,
          organizationId: owner.organizationId,
          title: input.title,
          config: input.config,
          codeArchive,
        }
        const executionId = yield* DeployRun.executionId(payload)
        const archive = yield* Effect.promise(() => new Bun.Archive(input.files, { compress: "gzip" }).bytes())
        const found = (yield* database.db.select().from(artifacts).where(eq(artifacts.id, id)).pipe(Effect.orDie)).at(0)
        if (found && !ownedBy(found, owner))
          return yield* new Primitive.Conflict({ message: `Artifact ${id} belongs to another space` })
        if (found && (yield* requested(DeployRun, executionId)))
          return yield* status(owner, id, input.deploymentId).pipe(Effect.orDie)
        if (found?.active_deployment_id === input.deploymentId)
          return yield* status(owner, id, input.deploymentId).pipe(Effect.orDie)
        yield* store((signal) =>
          storage.s3.send(
            new PutObjectCommand({
              Bucket: storage.bucket,
              Key: codeArchive,
              Body: archive,
              ContentType: "application/gzip",
            }),
            { abortSignal: signal },
          ),
        )
        yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* transaction
              .insert(artifacts)
              .values({
                id,
                organization_id: owner.organizationId,
                space_id: owner.spaceId,
                title: input.title,
                config: input.config,
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
            if (row.active_deployment_id === input.deploymentId) return
            if (row.active_deployment_id)
              return yield* new Primitive.Conflict({ message: `Artifact ${id} has active deployment work` })
            yield* transaction
              .update(artifacts)
              .set({ active_deployment_id: input.deploymentId, updated_at: sql`now()` })
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
        return yield* status(owner, id, input.deploymentId).pipe(Effect.orDie)
      }),
      status,
      files: Effect.fn("Artifacts.files")(function* (owner, id) {
        const row = (yield* database.db.select().from(artifacts).where(eq(artifacts.id, id)).pipe(Effect.orDie)).at(0)
        if (!row || !ownedBy(row, owner) || !row.code_archive)
          return yield* new Primitive.NotFound({ message: `Artifact ${id} does not exist` })
        return yield* read(row.code_archive)
      }),
      stop: Effect.fn("Artifacts.stop")(function* (owner, id) {
        const pending = yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const row = (yield* transaction.select().from(artifacts).where(eq(artifacts.id, id)).for("update")).at(0)
            if (!row || !ownedBy(row, owner)) return
            if (row.active_deployment_id) {
              const executionId = yield* DeployRun.executionId({
                id,
                deploymentId: row.active_deployment_id,
                organizationId: row.organization_id,
                title: row.title,
                config: row.config,
                codeArchive: row.code_archive ?? "",
              })
              if (!(yield* requested(DeployRun, executionId)))
                return { claimId: row.active_deployment_id, settlement: null }
            } else if (!row.binding && !row.url) return
            const stopId = Artifact.DeploymentID.make(crypto.randomUUID())
            const payload = {
              id,
              deploymentId: row.active_deployment_id ?? stopId,
              stopId,
              ...(row.active_deployment_id ? { targetDeploymentId: row.active_deployment_id } : {}),
            }
            const executionId = yield* StopRun.executionId(payload)
            yield* transaction
              .update(artifacts)
              .set({ active_deployment_id: stopId, updated_at: sql`now()` })
              .where(eq(artifacts.id, id))
            yield* StopRun.execute(payload, { discard: true }).pipe(
              Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
            )
            const settlement = { id, claimId: stopId, executionId, kind: "stop" as const }
            yield* SettleRun.execute(settlement, { discard: true }).pipe(
              Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
            )
            return { claimId: stopId, settlement }
          }),
        )
        if (!pending) return
        if (pending.settlement) {
          yield* SettleRun.execute(pending.settlement).pipe(
            Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
          )
          return
        }
        yield* database.db
          .select({ active: artifacts.active_deployment_id })
          .from(artifacts)
          .where(eq(artifacts.id, id))
          .pipe(
            Effect.orDie,
            Effect.repeat({
              schedule: Schedule.spaced("50 millis"),
              until: (rows) => rows.at(0)?.active !== pending.claimId,
            }),
          )
      }),
    })
  }),
).pipe(Layer.provide(ObjectStorage.layer))
