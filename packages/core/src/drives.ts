export * as Drives from "./drives.js"

import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3ServiceException,
  type _Object,
} from "@aws-sdk/client-s3"
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts"
import { createPresignedPost } from "@aws-sdk/s3-presigned-post"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import { Credential } from "@ren/schema/credential"
import { Drive } from "@ren/schema/drive"
import { FileSystem } from "@ren/schema/file-system"
import type { Space } from "@ren/schema/space"
import type { WriteResult } from "@ren/schema/write-result"
import { and, eq, isNull, lt } from "drizzle-orm"
import { ByteSize, Config, Context, DateTime, Duration, Effect, Layer, Option, Redacted, Schema, Stream } from "effect"
import { Access } from "./access.js"
import type { Actor } from "./actor.js"
import { DrivePolicy } from "./drives/policy.js"
import { FileSystemProvider } from "./file-system/provider.js"
import { Primitive } from "./primitive.js"
import { ObjectStorage } from "./object-storage.js"
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

export interface Owner {
  readonly organizationId: Auth.OrganizationID
  readonly spaceId: Space.ID
}

export interface Interface {
  readonly fileSystem: FileSystemProvider.Interface
  readonly startUpload: (
    actor: Actor.Info,
    input: Drive.StartUploadInput,
  ) => Effect.Effect<WriteResult.Upload, Primitive.NotFound | Primitive.Forbidden | Primitive.Invalid | Unavailable>
  readonly download: (
    actor: Actor.Info,
    input: Drive.DownloadInput,
  ) => Effect.Effect<Drive.Link, Primitive.NotFound | Primitive.Forbidden | Unavailable>
  readonly put: (owner: Owner, path: string, body: Uint8Array, type: string) => Effect.Effect<void, Unavailable>
  readonly files: (owner: Owner, folder: string) => Effect.Effect<ReadonlyArray<Drive.File>, Unavailable>
  readonly read: (owner: Owner, path: string) => Effect.Effect<Uint8Array, Primitive.NotFound | Unavailable>
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

const decodePath = Schema.decodeUnknownEffect(Drive.Path)

const valid = (path: string, field: string) =>
  decodePath(path).pipe(Effect.mapError((error) => new Primitive.Invalid({ message: error.message, field })))

const unavailable = <A, E, R>(effect: Effect.Effect<A, E | Unavailable, R>) =>
  Effect.catchIf(
    effect,
    (error): error is Unavailable => error instanceof Unavailable,
    (error) => Effect.fail(new FileSystemProvider.Unavailable({ cause: error.cause })),
  )

const filesOf = (root: string, objects: ReadonlyArray<_Object> | undefined): ReadonlyArray<Drive.File> =>
  (objects ?? []).flatMap((object) =>
    object.Key
      ? [
          {
            path: object.Key.slice(root.length),
            size: object.Size ?? 0,
            modifiedAt: DateTime.fromDateUnsafe(object.LastModified ?? new Date(0)),
          },
        ]
      : [],
  )

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.all({
      roleArn: Config.String("DRIVE_ROLE_ARN"),
      maxFileBytes: Config.ByteSize("DRIVE_MAX_FILE_SIZE").pipe(Config.withDefault(ByteSize.bytes(Drive.maxFileBytes))),
    })
    const database = yield* Database.Service
    const access = yield* Access.Service
    const storage = yield* ObjectStorage.Service
    const s3 = storage.s3
    const sts = new STSClient(storage.client)
    yield* Effect.addFinalizer(() => Effect.sync(() => sts.destroy()))
    const bucket = storage.bucket
    const maxFileBytes = ByteSize.toNumberUnsafe(config.maxFileBytes)
    const lifetime = Duration.toSeconds(linkLifetime)

    const send = <A>(run: (signal: AbortSignal) => Promise<A>) =>
      Effect.tryPromise({ try: run, catch: (cause) => new Unavailable({ cause }) })

    const exists = (key: string) =>
      send((signal) => s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: signal })).pipe(
        Effect.as(true),
        Effect.catchIf(isStatus(404), () => Effect.succeed(false)),
      )

    const allow = Effect.fnUntraced(function* (
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
      return { root: prefixOf({ organizationId: actor.organizationId, spaceId }), resource }
    })

    const prefix = (
      actor: Actor.Info,
      spaceId: Space.ID | undefined,
      action: (typeof DrivePolicy.actions)[keyof typeof DrivePolicy.actions],
    ) => Effect.map(allow(actor, spaceId, action), (allowed) => allowed.root)

    const fileKey = Effect.fnUntraced(function* (
      actor: Actor.Info,
      input: FileSystemProvider.PathInput,
      action: (typeof DrivePolicy.actions)[keyof typeof DrivePolicy.actions],
    ) {
      const path = yield* valid(input.path, "path")
      return { path, key: `${yield* prefix(actor, input.spaceId, action)}${path}` }
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
      fileSystem: {
        list: Effect.fn("Drives.fileSystem.list")(function* (actor: Actor.Info, input: FileSystemProvider.ListInput) {
          const raw = FileSystemProvider.folderOf(input.folder)
          const folder = raw ? yield* valid(raw, "folder") : ""
          const allowed = yield* allow(actor, input.spaceId, DrivePolicy.actions.read)
          const root = allowed.root
          const under = folder ? `${root}${folder}/` : root
          const listed = yield* send((signal) =>
            s3.send(
              new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: under,
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
          const folders = (listed.CommonPrefixes ?? [])
            .flatMap((common) =>
              common.Prefix ? [{ path: common.Prefix.slice(root.length), type: "directory" as const }] : [],
            )
            .filter((entry) => entry.path !== Drive.chatsFolder)
          const files = filesOf(root, listed.Contents)
            .filter((file) => `${root}${file.path}` !== under)
            .map((file) => ({
              path: file.path,
              type: "file" as const,
              size: file.size,
              modifiedAt: file.modifiedAt,
              mime: Drive.typeOf(file.path),
            }))
          return {
            entries: FileSystemProvider.sorted([...folders, ...files]),
            cursor: listed.NextContinuationToken ?? null,
            actions: access.isAllowed({ actor, action: DrivePolicy.actions.write, resource: allowed.resource })
              ? (["upload", "remove"] as const)
              : [],
          }
        }, unavailable),
        read: Effect.fn("Drives.fileSystem.read")(function* (actor: Actor.Info, input: FileSystemProvider.PathInput) {
          const file = yield* fileKey(actor, input, DrivePolicy.actions.read)
          const mime = Drive.typeOf(file.path)
          const object = yield* send((signal) =>
            s3.send(
              new GetObjectCommand({ Bucket: bucket, Key: file.key, Range: `bytes=0-${FileSystem.readLimit - 1}` }),
              { abortSignal: signal },
            ),
          ).pipe(
            Effect.map(Option.some),
            // oxlint-disable-next-line ren/no-comments -- S3 answers a range on an empty object with 416.
            Effect.catchIf(isStatus(416), () => Effect.succeed(Option.none())),
            Effect.catchIf(isStatus(404), () => Effect.fail(missing(file.path))),
          )
          if (Option.isNone(object))
            return FileSystem.contentOf({ path: file.path, mime, size: 0, bytes: new Uint8Array() })
          const body = object.value.Body
          if (!body) return yield* missing(file.path)
          const bytes = yield* send(() => body.transformToByteArray())
          const total = Number(object.value.ContentRange?.split("/").at(1))
          return FileSystem.contentOf({
            path: file.path,
            mime,
            size: Number.isInteger(total) ? total : bytes.length,
            bytes,
          })
        }, unavailable),
        remove: Effect.fn("Drives.fileSystem.remove")(function* (
          actor: Actor.Info,
          input: FileSystemProvider.PathInput,
        ) {
          const file = yield* fileKey(actor, input, DrivePolicy.actions.write)
          if (!(yield* exists(file.key))) return yield* missing(file.path)
          yield* send((signal) =>
            s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: file.key }), { abortSignal: signal }),
          )
        }, unavailable),
      },
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
      download: Effect.fn("Drives.download")(function* (actor: Actor.Info, input: Drive.DownloadInput) {
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
              ResponseContentDisposition: `${input.disposition ?? "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
              ...(input.disposition === "inline" && { ResponseContentType: Bun.file(name).type }),
            }),
            { expiresIn: lifetime },
          ),
        )
        return { url, expiresAt }
      }),
      put: Effect.fn("Drives.put")(function* (owner: Owner, path: string, body: Uint8Array, type: string) {
        yield* send((signal) =>
          s3.send(
            new PutObjectCommand({ Bucket: bucket, Key: `${prefixOf(owner)}${path}`, Body: body, ContentType: type }),
            { abortSignal: signal },
          ),
        )
      }),
      files: Effect.fn("Drives.files")(function* (owner: Owner, folder: string) {
        const root = prefixOf(owner)
        const pages = yield* Stream.paginate("", (cursor) =>
          send((signal) =>
            s3.send(
              new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: `${root}${folder}/`,
                ...(cursor && { ContinuationToken: cursor }),
              }),
              { abortSignal: signal },
            ),
          ).pipe(
            Effect.map(
              (listed) => [filesOf(root, listed.Contents), Option.fromNullishOr(listed.NextContinuationToken)] as const,
            ),
          ),
        ).pipe(Stream.runCollect)
        return pages.flat()
      }),
      read: Effect.fn("Drives.read")(function* (owner: Owner, path: string) {
        const object = yield* send((signal) =>
          s3.send(new GetObjectCommand({ Bucket: bucket, Key: `${prefixOf(owner)}${path}` }), { abortSignal: signal }),
        ).pipe(Effect.catchIf(isStatus(404), () => Effect.fail(missing(path))))
        const body = object.Body
        if (!body) return yield* missing(path)
        return yield* send(() => body.transformToByteArray())
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
              region: storage.region,
              ...(Option.isSome(storage.endpoint) && { endpoint: storage.endpoint.value }),
              placeholder,
            },
            access: kinds[kind].access,
          })),
        }
      },
      hosts: Option.match(storage.endpoint, {
        onNone: () => [`${bucket}.s3.${storage.region}.amazonaws.com`],
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
).pipe(Layer.provide(ObjectStorage.layer))
