export * as Harness from "./harness.js"

import type { BrainRejectedError, SessionNotStartedError, SyncUnavailableError } from "@ren/brain-api/errors"
import type { Form } from "@ren/schema/form"
import type { Models } from "@ren/schema/models"
import type { Permission } from "@ren/schema/permission"
import type { Session } from "@ren/schema/session"
import type { SessionEvent } from "@ren/schema/session-event"
import type { SessionCatalog } from "@ren/schema/session-catalog"
import type { SessionInbox } from "@ren/schema/session-inbox"
import type { SessionInfo } from "@ren/schema/session-info"
import type { SessionMessage } from "@ren/schema/session-message"
import type { SessionModel } from "@ren/schema/session-model"
import type { SessionStatus } from "@ren/schema/session-status"
import type { Shell } from "@ren/schema/shell"
import { Context, Effect, Exit, Layer, type Option, Schema, Scope, type Stream } from "effect"
import { Lease } from "../lease.js"
import type { Reconcile } from "../reconcile.js"

interface SessionState extends Reconcile.Snapshot {
  readonly id: string
  readonly resend: (id: string) => Effect.Effect<void>
  readonly wait: (ms: number) => Effect.Effect<void>
  readonly interrupt: Effect.Effect<void>
}

export type Refresh = (endpointId: string) => Effect.Effect<Option.Option<Models.ApiKey>>

export class NotFound extends Schema.TaggedError<NotFound>()("Harness.NotFound", { message: Schema.String }) {}

export class Rejected extends Schema.TaggedError<Rejected>()("Harness.Rejected", { message: Schema.String }) {}

export class Conflict extends Schema.TaggedError<Conflict>()("Harness.Conflict", { message: Schema.String }) {}

interface Mentions {
  readonly agents?: ReadonlyArray<SessionMessage.AgentAttachment>
  readonly skills?: ReadonlyArray<{ readonly id: string; readonly mention?: SessionMessage.Mention }>
}

interface Prompt extends Mentions {
  readonly id: SessionMessage.ID
  readonly text: string
  readonly delivery: SessionInbox.Delivery
  readonly sender: Option.Option<SessionMessage.Sender>
}

interface Command extends Mentions {
  readonly name: string
  readonly text: string
  readonly delivery: SessionInbox.Delivery
}

export interface Chat {
  readonly events: Stream.Stream<SessionEvent.Event, Error>
  readonly active: Effect.Effect<boolean>
  readonly status: Effect.Effect<SessionStatus.Family>
  readonly models: Effect.Effect<ReadonlyArray<SessionModel.Info>>
  readonly get: (sessionId: Session.ID) => Effect.Effect<SessionInfo.Info, NotFound>
  readonly children: (sessionId: Session.ID) => Effect.Effect<ReadonlyArray<SessionInfo.Info>, NotFound>
  readonly messages: (
    sessionId: Session.ID,
    page: { readonly limit?: number; readonly cursor?: string },
  ) => Effect.Effect<SessionMessage.Page, NotFound | Rejected>
  readonly message: (
    sessionId: Session.ID,
    messageId: SessionMessage.ID,
  ) => Effect.Effect<SessionMessage.Info, NotFound>
  readonly inbox: (sessionId: Session.ID) => Effect.Effect<ReadonlyArray<SessionInbox.Info>, NotFound>
  readonly permissions: (sessionId: Session.ID) => Effect.Effect<ReadonlyArray<Permission.Request>, NotFound>
  readonly forms: (sessionId: Session.ID) => Effect.Effect<ReadonlyArray<Form.Info>, NotFound>
  readonly prompt: (sessionId: Session.ID, prompt: Prompt) => Effect.Effect<void, NotFound | Conflict>
  readonly compact: (
    sessionId: Session.ID,
    id: SessionMessage.ID,
  ) => Effect.Effect<SessionInbox.Compaction, NotFound | Conflict>
  readonly interrupt: (sessionId: Session.ID, resume: boolean) => Effect.Effect<void, NotFound>
  readonly background: (sessionId: Session.ID) => Effect.Effect<void, NotFound>
  readonly rename: (sessionId: Session.ID, title: string) => Effect.Effect<void, NotFound>
  readonly revert: {
    readonly stage: (
      sessionId: Session.ID,
      messageId: SessionMessage.ID,
    ) => Effect.Effect<SessionInfo.Revert, NotFound | Conflict>
    readonly clear: (sessionId: Session.ID) => Effect.Effect<void, NotFound | Conflict>
    readonly commit: (sessionId: Session.ID) => Effect.Effect<void, NotFound | Conflict>
  }
  readonly cancelInbox: (sessionId: Session.ID, inboxId: SessionMessage.ID) => Effect.Effect<void, NotFound | Conflict>
  readonly updateInbox: (
    sessionId: Session.ID,
    inboxId: SessionMessage.ID,
    delivery: SessionInbox.Delivery,
  ) => Effect.Effect<void, NotFound | Conflict>
  readonly command: (sessionId: Session.ID, command: Command) => Effect.Effect<void, NotFound>
  readonly agents: (sessionId: Session.ID) => Effect.Effect<ReadonlyArray<SessionCatalog.Agent>, NotFound>
  readonly skills: (sessionId: Session.ID) => Effect.Effect<ReadonlyArray<SessionCatalog.Skill>, NotFound>
  readonly commands: (sessionId: Session.ID) => Effect.Effect<ReadonlyArray<SessionCatalog.Command>, NotFound>
  readonly files: (
    sessionId: Session.ID,
    search: { readonly query: string; readonly type?: SessionCatalog.FileType; readonly limit?: number },
  ) => Effect.Effect<ReadonlyArray<SessionCatalog.File>, NotFound>
  readonly switchModel: (sessionId: Session.ID, model: SessionModel.Ref) => Effect.Effect<void, NotFound | Rejected>
  readonly replyPermission: (
    sessionId: Session.ID,
    requestId: Permission.RequestID,
    reply: Permission.Reply,
  ) => Effect.Effect<void, NotFound>
  readonly replyForm: (
    sessionId: Session.ID,
    formId: Form.ID,
    answer: Form.Answer,
  ) => Effect.Effect<void, NotFound | Conflict | Rejected>
  readonly cancelForm: (sessionId: Session.ID, formId: Form.ID) => Effect.Effect<void, NotFound | Conflict>
  readonly shells: (sessionId: Session.ID) => Effect.Effect<ReadonlyArray<Shell.Info>, NotFound>
  readonly shellOutput: (
    sessionId: Session.ID,
    shellId: Shell.ID,
    page: { readonly cursor?: number; readonly limit?: number },
  ) => Effect.Effect<Shell.Output, NotFound>
  readonly removeShell: (sessionId: Session.ID, shellId: Shell.ID) => Effect.Effect<void, NotFound>
}

export interface Instance {
  readonly chat: Chat
  readonly fetch: (request: Request) => Promise<Response>
  readonly configure: (endpoints: ReadonlyArray<Models.Endpoint>) => Effect.Effect<void>
  readonly start: (
    input: Session.StartInput,
  ) => Effect.Effect<Session.Started, BrainRejectedError | SyncUnavailableError>
  readonly send: (
    input: Session.SendInput,
  ) => Effect.Effect<Session.Accepted, BrainRejectedError | SessionNotStartedError>
  readonly sessions: Effect.Effect<ReadonlyArray<SessionState>>
}

export interface Interface {
  readonly get: Effect.Effect<Instance, never, Scope.Scope>
  readonly state: Effect.Effect<{ readonly isOpen: boolean; readonly holders: number }>
  readonly close: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/Harness") {}

export const layer = (open: Effect.Effect<Instance, Error, Scope.Scope>) => {
  const lease = Lease.make(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const instance = yield* open.pipe(
        Scope.provide(scope),
        Effect.onError(() => Scope.close(scope, Exit.void)),
      )
      return { instance, scope }
    }),
    (opened) => Scope.close(opened.scope, Exit.void),
  )
  return Layer.succeed(
    Service,
    Service.of({
      get: lease.acquire.pipe(
        Effect.map((opened) => opened.instance),
        Effect.orDie,
      ),
      state: Effect.sync(() => ({ isOpen: lease.state().open, holders: lease.state().leases })),
      close: lease.close,
    }),
  )
}
