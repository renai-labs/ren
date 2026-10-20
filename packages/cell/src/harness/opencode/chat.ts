export * as OpenCodeChat from "./chat.js"

import type { SessionListInput } from "@opencode/client/effect/api"
import { Permission } from "@opencode/schema/permission"
import { SessionID } from "@opencode/schema/session-id"
import { SessionMessage } from "@opencode/schema/session-message"
import type { Session as OpenCodeSession } from "@opencode/schema/session"
import { Skill } from "@opencode/schema/skill"
import type { Session } from "@ren/schema/session"
import { SessionCapabilities } from "@ren/schema/session/capabilities"
import type { SessionStatus } from "@ren/schema/session/status"
import type { Shell } from "@ren/schema/shell"
import { Clock, Effect, Option, Predicate, Stream } from "effect"
import { Harness } from "../harness.js"
import type { OpenCodeServer } from "./server.js"
import { OpenCodeEvents } from "./events.js"
import { Translate } from "./translate.js"

const capabilities = SessionCapabilities.of("opencode")

const missing = (error: { readonly message: string }) => Effect.fail(new Harness.NotFound({ message: error.message }))
const conflict = (error: { readonly message: string }) => Effect.fail(new Harness.Conflict({ message: error.message }))
const rejected = (error: { readonly message: string }) => Effect.fail(new Harness.Rejected({ message: error.message }))
const absent = () => Effect.succeed(false)
const located = { SessionNotFoundError: missing, LocationNotFoundError: missing }

const readOne = <A, B>(item: A, translate: (item: A) => Option.Option<B>) =>
  Option.match(translate(item), {
    onNone: () =>
      Effect.logError("The brain cannot read a value OpenCode returned", item).pipe(
        Effect.andThen(Effect.die(new Error("The brain cannot read a value OpenCode returned"))),
      ),
    onSome: Effect.succeed,
  })

const readAll = <A, B>(items: ReadonlyArray<A>, translate: (item: A) => Option.Option<B>) =>
  Effect.forEach(items, (item) => readOne(item, translate))

export const make = (
  host: Pick<
    OpenCodeServer.Instance,
    "fetch" | "client" | "shells" | "agents" | "skills" | "commands" | "findFiles" | "webSearchProviders"
  >,
): Harness.Chat => {
  const api = host.client

  const session = (info: OpenCodeSession.Info) => Translate.session(info, capabilities)

  const get = (sessionId: Session.ID) =>
    api.session.get({ sessionID: SessionID.make(sessionId) }).pipe(
      Effect.catchTags({ SessionNotFoundError: missing }, Effect.die),
      Effect.flatMap((info) => readOne(info, session)),
    )

  const inbox = (sessionId: Session.ID) =>
    api.session.inbox.list({ sessionID: SessionID.make(sessionId) }).pipe(
      Effect.catchTags({ SessionNotFoundError: missing }, Effect.die),
      Effect.flatMap((items) => readAll(items, Translate.inbox)),
    )

  const delivered = (sessionId: Session.ID, messageId: SessionMessage.ID) =>
    api.session.message
      .get({ sessionID: SessionID.make(sessionId), messageID: messageId })
      .pipe(
        Effect.as(true),
        Effect.catchTags({ SessionNotFoundError: absent, MessageNotFoundError: absent }, Effect.die),
      )

  const active = api.session.active().pipe(Effect.orDie, Effect.map(Object.keys))

  return {
    events: OpenCodeEvents.stream(host.fetch).pipe(
      Stream.mapEffect((raw) =>
        Effect.gen(function* () {
          const translated = Translate.frame(raw, yield* Clock.currentTimeMillis)
          if (Option.isNone(translated) && Translate.isAllowed(raw))
            return yield* Effect.fail(new Error("The brain cannot read an OpenCode event Ren supports", { cause: raw }))
          return Option.toArray(translated)
        }),
      ),
      Stream.flattenIterable,
    ),
    active: Effect.map(active, (ids) => ids.length > 0),
    status: Effect.map(active, (ids) =>
      Object.fromEntries(ids.map((id): [string, SessionStatus.Info] => [id, { type: "busy" }])),
    ),
    models: api.model.list().pipe(
      Effect.orDie,
      Effect.map((page) =>
        page.data
          .filter((model) => model.enabled)
          .map((model) => ({
            id: model.id,
            providerID: model.providerID,
            name: model.name,
            variants: model.variants.map((variant) => ({ id: variant.id })),
            input: model.capabilities.input,
            limit: { context: model.limit.context, output: model.limit.output },
          })),
      ),
    ),
    get,
    children: (sessionId) =>
      Effect.gen(function* () {
        yield* get(sessionId)
        const children = yield* Stream.paginate(undefined, (cursor: SessionListInput["cursor"]) =>
          api.session.list({ parentID: SessionID.make(sessionId), cursor }).pipe(
            Effect.orDie,
            Effect.map((page) => [page.data, Option.fromNullishOr(page.cursor.next)] as const),
          ),
        ).pipe(Stream.runCollect)
        return yield* readAll(children, session)
      }),
    messages: (sessionId, page) =>
      Effect.gen(function* () {
        const found = yield* api.message
          .list({
            sessionID: SessionID.make(sessionId),
            ...(page.limit && { limit: page.limit }),
            ...(page.cursor ? { cursor: page.cursor } : { order: "desc" }),
          })
          .pipe(
            Effect.catchTags(
              { SessionNotFoundError: missing, InvalidCursorError: rejected, InvalidRequestError: rejected },
              Effect.die,
            ),
          )
        return {
          items: yield* readAll(found.data, Translate.message),
          cursor: {
            ...(found.cursor.previous && { previous: found.cursor.previous }),
            ...(found.cursor.next && { next: found.cursor.next }),
          },
        }
      }),
    message: (sessionId, messageId) =>
      api.session.message
        .get({ sessionID: SessionID.make(sessionId), messageID: SessionMessage.ID.make(messageId) })
        .pipe(
          Effect.catchTags({ SessionNotFoundError: missing, MessageNotFoundError: missing }, Effect.die),
          Effect.flatMap((info) => readOne(info, Translate.message)),
        ),
    inbox,
    permissions: (sessionId) =>
      api.permission.list({ sessionID: SessionID.make(sessionId) }).pipe(
        Effect.catchTags(located, Effect.die),
        Effect.flatMap((requests) => readAll(requests, Translate.permission)),
      ),
    forms: (sessionId) =>
      api.session.form.list({ sessionID: sessionId }).pipe(
        Effect.catchTags(located, Effect.die),
        Effect.flatMap((forms) => readAll(forms, Translate.form)),
      ),
    prompt: (sessionId, prompt) =>
      api.session
        .prompt({
          sessionID: SessionID.make(sessionId),
          id: SessionMessage.ID.make(prompt.id),
          text: prompt.text,
          delivery: prompt.delivery,
          ...(Predicate.isBoolean(prompt.resume) && { resume: prompt.resume }),
          ...(prompt.agents && { agents: prompt.agents }),
          ...(prompt.skills && { skills: prompt.skills.map((skill) => ({ ...skill, id: Skill.ID.make(skill.id) })) }),
          ...Option.match(prompt.sender, {
            onNone: () => ({}),
            onSome: (sender) => ({
              metadata: { userID: sender.userId, ...(sender.name && { userName: sender.name }) },
            }),
          }),
        })
        .pipe(
          Effect.catchTags({ ...located, ConflictError: conflict }, Effect.die),
          Effect.asVoid,
          Effect.catchTag("Harness.Conflict", (error) =>
            Effect.gen(function* () {
              const sent = yield* delivered(sessionId, SessionMessage.ID.make(prompt.id))
              const queued = (yield* inbox(sessionId)).some((item) => item.id === prompt.id)
              if (!sent && !queued) return yield* error
            }),
          ),
        ),
    compact: (sessionId, id) =>
      api.session.compact({ sessionID: SessionID.make(sessionId), id: SessionMessage.ID.make(id) }).pipe(
        Effect.catchTags({ ...located, ConflictError: conflict }, Effect.die),
        Effect.flatMap((compaction) => readOne(compaction, Translate.compaction)),
      ),
    interrupt: (sessionId, options) =>
      api.session
        .interrupt({ sessionID: SessionID.make(sessionId), ...(options.resume && { resume: true }) })
        .pipe(Effect.catchTags(located, Effect.die), Effect.asVoid),
    background: (sessionId) =>
      api.session.background({ sessionID: SessionID.make(sessionId) }).pipe(Effect.catchTags(located, Effect.die)),
    rename: (sessionId, title) =>
      api.session.update({ sessionID: SessionID.make(sessionId), title }).pipe(Effect.catchTags(located, Effect.die)),
    revert: {
      stage: (sessionId, messageId) =>
        Effect.gen(function* () {
          const sessionID = SessionID.make(sessionId)
          yield* api.session.interrupt({ sessionID }).pipe(Effect.catchTags(located, Effect.die))
          yield* api.session.wait({ sessionID }).pipe(Effect.catchTags(located, Effect.die))
          const staged = yield* api.session.revert
            .stage({ sessionID, messageID: SessionMessage.ID.make(messageId) })
            .pipe(
              Effect.catchTags({ ...located, MessageNotFoundError: missing, SessionBusyError: conflict }, Effect.die),
            )
          return yield* readOne(staged, Translate.revert)
        }),
      clear: (sessionId) =>
        api.session.revert
          .clear({ sessionID: SessionID.make(sessionId) })
          .pipe(Effect.catchTags({ ...located, SessionBusyError: conflict }, Effect.die)),
      commit: (sessionId) =>
        api.session.revert
          .commit({ sessionID: SessionID.make(sessionId) })
          .pipe(Effect.catchTags({ ...located, SessionBusyError: conflict }, Effect.die)),
    },
    cancelInbox: (sessionId, inboxId) =>
      Effect.gen(function* () {
        const inboxID = SessionMessage.ID.make(inboxId)
        yield* api.session.inbox
          .cancel({ sessionID: SessionID.make(sessionId), inboxID })
          .pipe(Effect.catchTags({ SessionNotFoundError: missing }, Effect.die))
        if (yield* delivered(sessionId, inboxID))
          return yield* new Harness.Conflict({ message: `The session took input ${inboxId} before it was withdrawn` })
      }),
    updateInbox: (sessionId, inboxId, delivery) =>
      api.session.inbox
        .update({ sessionID: SessionID.make(sessionId), inboxID: SessionMessage.ID.make(inboxId), delivery })
        .pipe(Effect.catchTags({ SessionNotFoundError: missing, ConflictError: conflict }, Effect.die)),
    command: (sessionId, command) =>
      api.session
        .command({
          sessionID: SessionID.make(sessionId),
          name: command.name,
          text: command.text,
          delivery: command.delivery,
          ...(command.agents && { agents: command.agents }),
          ...(command.skills && {
            skills: command.skills.map((skill) => ({ ...skill, id: Skill.ID.make(skill.id) })),
          }),
        })
        .pipe(Effect.catchTags({ ...located, CommandNotFoundError: missing }, Effect.die)),
    agents: (sessionId) => host.agents(sessionId).pipe(Effect.flatMap((all) => readAll(all, Translate.agent))),
    skills: (sessionId) => host.skills(sessionId).pipe(Effect.flatMap((all) => readAll(all, Translate.skill))),
    commands: (sessionId) => host.commands(sessionId).pipe(Effect.flatMap((all) => readAll(all, Translate.command))),
    files: (sessionId, search) =>
      host.findFiles(sessionId, search).pipe(Effect.flatMap((all) => readAll(all, Translate.file))),
    webSearchProviders: (sessionId) =>
      host
        .webSearchProviders(sessionId)
        .pipe(Effect.map((all) => all.map((provider) => ({ id: provider.id, name: provider.name })))),
    replyPermission: (sessionId, requestId, reply, message) =>
      api.permission
        .reply({
          sessionID: SessionID.make(sessionId),
          requestID: Permission.ID.make(requestId),
          decision: reply,
          ...(message && { message }),
        })
        .pipe(Effect.catchTags({ ...located, PermissionNotFoundError: missing }, Effect.die)),
    replyForm: (sessionId, formId, answer) =>
      api.session.form.reply({ sessionID: sessionId, formID: formId, answer }).pipe(
        Effect.catchTags(
          {
            ...located,
            FormNotFoundError: missing,
            FormAlreadySettledError: conflict,
            FormInvalidAnswerError: rejected,
            InvalidRequestError: rejected,
          },
          Effect.die,
        ),
      ),
    cancelForm: (sessionId, formId) =>
      api.session.form
        .cancel({ sessionID: sessionId, formID: formId })
        .pipe(
          Effect.catchTags({ ...located, FormNotFoundError: missing, FormAlreadySettledError: conflict }, Effect.die),
        ),
    shells: (sessionId) =>
      host.shells(sessionId, (shell) => shell.list()).pipe(Effect.flatMap((all) => readAll(all, Translate.shell))),
    shellOutput: (sessionId, shellId, page) =>
      host
        .shells(sessionId, (shell) =>
          shell
            .output(shellId, page)
            .pipe(
              Effect.catchTag("Shell.NotFoundError", () =>
                Effect.fail(new Harness.NotFound({ message: `Shell ${shellId} is not running or kept` })),
              ),
            ),
        )
        .pipe(Effect.map((output): Shell.Output => output)),
    removeShell: (sessionId, shellId) =>
      host.shells(sessionId, (shell) =>
        shell.remove(shellId).pipe(Effect.catchTag("Shell.NotFoundError", () => Effect.void)),
      ),
  }
}
