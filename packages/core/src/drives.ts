export * as Drives from "./drives.js"

import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3"
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts"
import { createPresignedPost } from "@aws-sdk/s3-presigned-post"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import { Credential } from "@ren/schema/credential"
import type { Drive } from "@ren/schema/drive"
import type { Space } from "@ren/schema/space"
import type { WriteResult } from "@ren/schema/write-result"
import { and, eq, isNull, lt } from "drizzle-orm"
import { ByteSize, Config, Context, DateTime, Duration, Effect, Layer, Option, Redacted, Schema } from "effect"
import { Access } from "./access.js"
import type { Actor } from "./actor.js"
import { DrivePolicy } from "./drives/policy.js"
import { Primitive } from "./primitive.js"
import { SpaceQueries } from "./space/queries.js"

export class Unavailable extends Schema.TaggedError<Unavailable>()("Drives.Unavailable", {
  cause: Schema.Defect(),
}) {}

export interface Keys {
  readonly accessKeyId: string
  readonly secretAccessKey: Redacted.Redacted
  readonly sessionToken: Redacted.Redacted
  readonly expiresAt: DateTime.Utc
}

export interface Interface {
  readonly list: (
    actor: Actor.Info,
    input: Drive.ListInput,
  ) => Effect.Effect<Drive.Listing, Primitive.NotFound | Primitive.Forbidden | Primitive.Invalid | Unavailable>
  readonly startUpload: (
    actor: Actor.Info,
    input: Drive.StartUploadInput,
  ) => Effect.Effect<WriteResult.Upload, Primitive.NotFound | Primitive.Forbidden | Primitive.Invalid | Unavailable>
  readonly download: (
    actor: Actor.Info,
    input: Drive.PathInput,
  ) => Effect.Effect<Drive.Link, Primitive.NotFound | Primitive.Forbidden | Unavailable>
  readonly delete: (
    actor: Actor.Info,
    input: Drive.PathInput,
  ) => Effect.Effect<void, Primitive.NotFound | Primitive.Forbidden | Unavailable>
  readonly sweep: (archivedBefore: Date) => Effect.Effect<void>
  readonly availability: (
    owner: { readonly organizationId: Auth.OrganizationID; readonly spaceId: Space.ID },
    environment: { readonly canMount: boolean; readonly egress: boolean },
  ) => Drive.Availability
  readonly hosts: ReadonlyArray<string>
  readonly keys: (owner: {
    readonly organizationId: Auth.OrganizationID
    readonly spaceId: Space.ID
  }) => Effect.Effect<Keys, Unavailable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Drives") {}

export const linkLifetime = Duration.minutes(15)

export const keysLifetime = Duration.hours(1)

export const label = "DRIVE"

export const placeholder = Credential.placeholder(label)

const kinds: Record<Drive.Kind, { readonly access: Drive.Access; readonly description: string }> = {
  space: { access: "write", description: "The files of this space’s drive in Ren." },
  org: { access: "read", description: "The files of the organization’s drive in Ren. Read-only." },
}

export const prefixOf = (owner: {
  readonly organizationId: Auth.OrganizationID
  readonly spaceId?: Space.ID | undefined
}) =>
  owner.spaceId ? `${owner.organizationId}/drives/spaces/${owner.spaceId}/` : `${owner.organizationId}/drives/org/`

const isStatus = (status: number) => (error: Unavailable) =>
  error.cause instanceof S3ServiceException && error.cause.$metadata.httpStatusCode === status

const missing = (path: string) => new Primitive.NotFound({ message: `The drive has no file ${path}.` })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.all({
      bucket: Config.String("DRIVE_BUCKET"),
      region: Config.String("DRIVE_REGION").pipe(Config.withDefault("us-east-1")),
      endpoint: Config.option(Config.String("DRIVE_ENDPOINT")),
      roleArn: Config.String("DRIVE_ROLE_ARN"),
      accessKeyId: Config.option(Config.String("DRIVE_ACCESS_KEY_ID")),
      secretAccessKey: Config.option(Config.Redacted("DRIVE_SECRET_ACCESS_KEY")),
      maxFileBytes: Config.ByteSize("DRIVE_MAX_FILE_SIZE").pipe(Config.withDefault(ByteSize.mebibytes(100))),
    })
    const database = yield* Database.Service
    const access = yield* Access.Service
    const client = {
      region: config.region,
      ...(Option.isSome(config.endpoint) && { endpoint: config.endpoint.value }),
      ...(Option.isSome(config.accessKeyId) &&
        Option.isSome(config.secretAccessKey) && {
          credentials: {
            accessKeyId: config.accessKeyId.value,
            secretAccessKey: Redacted.value(config.secretAccessKey.value),
          },
        }),
    }
    const s3 = new S3Client({ ...client, forcePathStyle: Option.isSome(config.endpoint) })
    const sts = new STSClient(client)
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        s3.destroy()
        sts.destroy()
      }),
    )
    const bucket = config.bucket
    const maxFileBytes = ByteSize.toNumberUnsafe(config.maxFileBytes)
    const lifetime = Duration.toSeconds(linkLifetime)

    const send = <A>(run: (signal: AbortSignal) => Promise<A>) =>
      Effect.tryPromise({ try: run, catch: (cause) => new Unavailable({ cause }) })

    const exists = (key: string) =>
      send((signal) => s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: signal })).pipe(
        Effect.as(true),
        Effect.catchIf(isStatus(404), () => Effect.succeed(false)),
      )

    const prefix = Effect.fnUntraced(function* (
      actor: Actor.Info,
      spaceId: Space.ID | undefined,
      action: (typeof DrivePolicy.actions)[keyof typeof DrivePolicy.actions],
    ) {
      const isAgent = Boolean(actor.agent)
      const resource = spaceId
        ? yield* Effect.gen(function* () {
            const space = (yield* database.db
              .select({ membershipId: SpaceQueries.membership.id })
              .from(Database.Schema.space)
              .leftJoin(SpaceQueries.membership, SpaceQueries.membershipOf(actor))
              .where(
                and(
                  eq(Database.Schema.space.id, spaceId),
                  eq(Database.Schema.space.organization_id, actor.organizationId),
                  isNull(Database.Schema.space.archived_at),
                ),
              )
              .pipe(Effect.orDie)).at(0)
            if (!space) return yield* new Primitive.NotFound({ message: "Space not found." })
            return DrivePolicy.space({ isMember: Boolean(space.membershipId), isAgent })
          })
        : DrivePolicy.organization({ isAgent })
      if (!access.isAllowed({ actor, action, resource })) {
        if (isAgent)
          return yield* new Primitive.Forbidden({ message: "An agent reads a drive only on its environment." })
        return yield* new Primitive.NotFound({ message: "Space not found." })
      }
      return prefixOf({ organizationId: actor.organizationId, spaceId })
    })

    const deletePage = Effect.fnUntraced(function* (under: string) {
      const listed = yield* send((signal) =>
        s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: under }), { abortSignal: signal }),
      )
      const keys = (listed.Contents ?? []).flatMap((object) => (object.Key ? [{ Key: object.Key }] : []))
      if (keys.length === 0) return false
      const deleted = yield* send((signal) =>
        s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }), {
          abortSignal: signal,
        }),
      )
      if (deleted.Errors?.length) return yield* new Unavailable({ cause: deleted.Errors })
      return listed.IsTruncated ?? false
    })

    return Service.of({
      list: Effect.fn("Drives.list")(function* (actor: Actor.Info, input: Drive.ListInput) {
        const root = yield* prefix(actor, input.spaceId, DrivePolicy.actions.read)
        const folder = input.folder ? `${root}${input.folder}/` : root
        const listed = yield* send((signal) =>
          s3.send(
            new ListObjectsV2Command({
              Bucket: bucket,
              Prefix: folder,
              Delimiter: "/",
              ...(input.cursor && { ContinuationToken: input.cursor }),
            }),
            { abortSignal: signal },
          ),
        ).pipe(
          Effect.catchIf(
            (error) => Boolean(input.cursor) && isStatus(400)(error),
            () => Effect.fail(new Primitive.Invalid({ message: "The cursor is not valid.", field: "cursor" })),
          ),
        )
        return {
          folders: (listed.CommonPrefixes ?? []).flatMap((common) =>
            common.Prefix ? [common.Prefix.slice(root.length, -1)] : [],
          ),
          files: (listed.Contents ?? []).flatMap((object) =>
            object.Key && object.Key !== folder
              ? [
                  {
                    path: object.Key.slice(root.length),
                    size: object.Size ?? 0,
                    modifiedAt: DateTime.fromDateUnsafe(object.LastModified ?? new Date(0)),
                  },
                ]
              : [],
          ),
          cursor: listed.NextContinuationToken ?? null,
        }
      }),
      startUpload: Effect.fn("Drives.startUpload")(function* (actor: Actor.Info, input: Drive.StartUploadInput) {
        const root = yield* prefix(actor, input.spaceId, DrivePolicy.actions.write)
        if (input.size > maxFileBytes)
          return yield* new Primitive.Invalid({
            message: `A file is at most ${ByteSize.format(config.maxFileBytes)}.`,
            field: "size",
          })
        const expiresAt = DateTime.addDuration(yield* DateTime.now, linkLifetime)
        const post = yield* send(() =>
          createPresignedPost(s3, {
            Bucket: bucket,
            Key: `${root}${input.path}`,
            Fields: { "x-amz-meta-uploaded-by": actor.userId },
            Conditions: [["content-length-range", input.size, input.size]],
            Expires: lifetime,
          }),
        )
        return { uploadId: input.path, uploadUrl: post.url, fields: post.fields, expiresAt }
      }),
      download: Effect.fn("Drives.download")(function* (actor: Actor.Info, input: Drive.PathInput) {
        const key = `${yield* prefix(actor, input.spaceId, DrivePolicy.actions.read)}${input.path}`
        if (!(yield* exists(key))) return yield* missing(input.path)
        const name = input.path.split("/").at(-1) ?? input.path
        const expiresAt = DateTime.addDuration(yield* DateTime.now, linkLifetime)
        const url = yield* send(() =>
          getSignedUrl(
            s3,
            new GetObjectCommand({
              Bucket: bucket,
              Key: key,
              ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
            }),
            { expiresIn: lifetime },
          ),
        )
        return { url, expiresAt }
      }),
      delete: Effect.fn("Drives.delete")(function* (actor: Actor.Info, input: Drive.PathInput) {
        const key = `${yield* prefix(actor, input.spaceId, DrivePolicy.actions.write)}${input.path}`
        if (!(yield* exists(key))) return yield* missing(input.path)
        yield* send((signal) => s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: signal }))
      }),
      availability: (owner, environment) => {
        if (!environment.canMount) return { type: "unavailable", reason: "no_mount" }
        if (!environment.egress) return { type: "unavailable", reason: "no_egress" }
        return {
          type: "mounts",
          mounts: (["space", "org"] as const).map((kind) => ({
            kind,
            alias: `drive:${kind}`,
            description: kinds[kind].description,
            remote: {
              type: "s3",
              bucket,
              prefix: prefixOf({
                organizationId: owner.organizationId,
                ...(kind === "space" && { spaceId: owner.spaceId }),
              }),
              region: config.region,
              ...(Option.isSome(config.endpoint) && { endpoint: config.endpoint.value }),
              placeholder,
            },
            access: kinds[kind].access,
          })),
        }
      },
      hosts: Option.match(config.endpoint, {
        onNone: () => [`${bucket}.s3.${config.region}.amazonaws.com`],
        onSome: (endpoint) => [new URL(endpoint).hostname],
      }),
      keys: Effect.fn("Drives.keys")(function* (owner) {
        const prefixes = [prefixOf(owner), prefixOf({ organizationId: owner.organizationId })]
        const assumed = yield* send((signal) =>
          sts.send(
            new AssumeRoleCommand({
              RoleArn: config.roleArn,
              RoleSessionName: `drive-${owner.spaceId}`,
              DurationSeconds: Duration.toSeconds(keysLifetime),
              Policy: JSON.stringify({
                Version: "2012-10-17",
                Statement: [
                  {
                    Effect: "Allow",
                    Action: ["s3:ListBucket"],
                    Resource: [`arn:aws:s3:::${bucket}`],
                    Condition: { StringLike: { "s3:prefix": prefixes.map((each) => `${each}*`) } },
                  },
                  {
                    Effect: "Allow",
                    Action: ["s3:GetObject"],
                    Resource: prefixes.map((each) => `arn:aws:s3:::${bucket}/${each}*`),
                  },
                  {
                    Effect: "Allow",
                    Action: ["s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload"],
                    Resource: [`arn:aws:s3:::${bucket}/${prefixOf(owner)}*`],
                  },
                ],
              }),
            }),
            { abortSignal: signal },
          ),
        )
        const keys = assumed.Credentials
        if (!keys?.AccessKeyId || !keys.SecretAccessKey || !keys.SessionToken || !keys.Expiration)
          return yield* new Unavailable({ cause: new Error("STS answered without keys") })
        return {
          accessKeyId: keys.AccessKeyId,
          secretAccessKey: Redacted.make(keys.SecretAccessKey),
          sessionToken: Redacted.make(keys.SessionToken),
          expiresAt: DateTime.makeUnsafe(keys.Expiration),
        }
      }),
      sweep: Effect.fn("Drives.sweep")(function* (archivedBefore: Date) {
        const spaces = yield* database.db
          .select({ spaceId: Database.Schema.space.id, organizationId: Database.Schema.space.organization_id })
          .from(Database.Schema.space)
          .where(lt(Database.Schema.space.archived_at, archivedBefore))
          .pipe(Effect.orDie)
        yield* Effect.forEach(
          spaces,
          (space) =>
            deletePage(prefixOf(space)).pipe(
              Effect.repeat({ while: (more) => more }),
              Effect.catch((error) =>
                Effect.logWarning("Retention kept an archived drive for the next run", error.cause).pipe(
                  Effect.annotateLogs({ "ren.space.id": space.spaceId }),
                ),
              ),
            ),
          { concurrency: 4, discard: true },
        )
      }),
    })
  }),
)
