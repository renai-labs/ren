import { Session } from "@ren/schema/session"
import { Sync } from "@ren/schema/sync"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { StaleUploadError } from "./errors.js"
import { HostAuthentication } from "./ren-host-api.js"

const SessionParams = { id: Session.ID }

const UploadParams = { id: Session.ID, upload: Schema.Int }

const MessagesQuery = Schema.Struct({
  afterSeq: Schema.optionalKey(Schema.Int),
  afterId: Schema.optionalKey(Schema.String),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
}).check(
  Schema.makeFilter((query) => "afterSeq" in query === "afterId" in query || "Send afterSeq and afterId together"),
)

const SyncGroup = HttpApiGroup.make("sync")
  .add(
    HttpApiEndpoint.post("sync.checkpoints", "/host/sync/checkpoints", {
      success: Schema.Struct({ sessions: Schema.Array(Sync.Checkpoint) }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "sync.checkpoints",
        summary: "Read the checkpoints",
        description: "Read the Ren copy of each session in the scope of the host token.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("sync.startUpload", "/host/sync/sessions/:id/uploads", {
      params: SessionParams,
      payload: Schema.Struct({
        harness: Session.Harness,
        parentId: Schema.NullOr(Session.ID).annotate({
          description:
            "The parent that the host reports. Ren adopts an unknown session when its parent is in the scope.",
        }),
      }),
      success: Schema.Struct({ upload: Schema.Int }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "sync.startUpload",
        summary: "Start an upload",
        description: "Open a new upload of a session. Writes of an older upload of the session fail from now on.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("sync.uploadMessages", "/host/sync/sessions/:id/uploads/:upload/messages", {
      params: UploadParams,
      payload: Schema.Struct({ messages: Schema.Array(Sync.OpenCodeMessageRow) }),
      error: StaleUploadError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "sync.uploadMessages",
        summary: "Upload messages",
        description: "Write a batch of message rows to the open upload.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("sync.commit", "/host/sync/sessions/:id/uploads/:upload/commit", {
      params: UploadParams,
      payload: Schema.Struct({
        session: Sync.OpenCodeSessionRow,
        seq: Schema.Int.annotate({ description: "The OpenCode checkpoint that the host read before the messages." }),
        ids: Schema.Array(Schema.String).annotate({
          description:
            "The IDs of all messages that the upload sent. Ren marks the other messages of the session removed.",
        }),
        revertMessageId: Schema.optionalKey(Schema.NullOr(Schema.String)).annotate({
          description: "The first message that the session’s staged revert hides, or null.",
        }),
        inbox: Schema.optionalKey(Schema.Array(Sync.OpenCodeInboxRow)).annotate({
          description: "The session’s queued messages. Ren replaces the ones it has.",
        }),
      }),
      error: StaleUploadError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "sync.commit",
        summary: "Commit an upload",
        description: "Write the session row, delete the messages that the upload did not send, and close the upload.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("sync.restore", "/host/sync/restore", {
      payload: Schema.Struct({ sessionId: Session.ID }),
      success: Schema.Struct({ chats: Schema.Array(Sync.RestoredChat) }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "sync.restore",
        summary: "Restore a session tree",
        description:
          "Close the open uploads of the tree and clear its checkpoints. Return the session rows of the tree, each parent before its children.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("sync.messages", "/host/sync/sessions/:id/messages", {
      params: SessionParams,
      query: MessagesQuery,
      success: Schema.Struct({ messages: Schema.Array(Sync.OpenCodeMessageRow), next: Schema.NullOr(Sync.Cursor) }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "sync.messages",
        summary: "Read messages",
        description: "Read one page of the message rows of a session in `(seq, id)` order.",
      }),
    ),
  )
  .middleware(HostAuthentication)
  .annotateMerge(OpenApi.annotations({ title: "sync" }))

export const SyncApi = HttpApi.make("sync")
  .add(SyncGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "Ren Sync API",
      version: "0.0.0",
      description: `Internal API a session host calls to upload and restore its sessions. Ren refuses a body larger than ${Sync.maxBodyBytes} bytes.`,
    }),
  )
