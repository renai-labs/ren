export * as OpenCodeChat from "./chat.js"

import type { Form } from "@ren/schema/form"
import type { Permission } from "@ren/schema/permission"
import type { Session } from "@ren/schema/session"
import { SessionCapabilities } from "@ren/schema/session/capabilities"
import { SessionInbox } from "@ren/schema/session/inbox"
import { SessionInfo } from "@ren/schema/session/info"
import type { SessionMessage } from "@ren/schema/session/message"
import { SessionModel } from "@ren/schema/session/model"
import type { SessionStatus } from "@ren/schema/session/status"
import type { Shell } from "@ren/schema/shell"
import { Clock, Effect, Option, Predicate, Schema, Semaphore, Stream } from "effect"
import { Harness } from "../harness.js"
import type { OpenCodeServer } from "./server.js"
import { OpenCodeEvents } from "./events.js"
import { Translate } from "./translate.js"

const capabilities = SessionCapabilities.of("opencode")

const Data = Schema.Struct({ data: Schema.Array(Schema.Unknown) })
const One = Schema.Struct({ data: Schema.Unknown })
const unwrap = (raw: unknown) => Option.map(Schema.decodeUnknownOption(One)(raw), (one) => one.data)
const Page = Schema.Struct({
  data: Schema.Array(Schema.Unknown),
  cursor: Schema.Struct({
    previous: Schema.optionalKey(Schema.NullOr(Schema.String)),
    next: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
})
const Active = Schema.Struct({ data: Schema.Record(Schema.String, Schema.Unknown) })
const Model = Schema.Struct({
  id: Schema.String,
  providerID: Schema.String,
  name: Schema.String,
  enabled: Schema.Boolean,
  variants: Schema.Array(Schema.Struct({ id: Schema.String })),
  capabilities: Schema.Struct({ input: Schema.Array(Schema.String) }),
  limit: Schema.Struct({ context: Schema.Int, output: Schema.Int }),
})

type Failure = Harness.NotFound | Harness.Rejected | Harness.Conflict

const failure = (status: number, message: string): Option.Option<Failure> => {
  if (status === 404) return Option.some(new Harness.NotFound({ message }))
  if (status === 409) return Option.some(new Harness.Conflict({ message }))
  if (status === 400) return Option.some(new Harness.Rejected({ message }))
  return Option.none()
}

const ErrorBody = Schema.Struct({ message: Schema.String })

const decodeCompaction = Schema.decodeUnknownOption(SessionInbox.Compaction)

const decodeRevert = Schema.decodeUnknownOption(SessionInfo.Revert)

const Speaker = Schema.Struct({
  metadata: Schema.optionalKey(Schema.Struct({ userID: Schema.optionalKey(Schema.String) })),
})
const decodeSpoken = Schema.decodeUnknownOption(Schema.Struct({ type: Schema.Literal("user"), ...Speaker.fields }))
const decodeQueued = Schema.decodeUnknownOption(Schema.Struct({ type: Schema.Literal("user"), payload: Speaker }))

const attribution = (name: string, userId: string) =>
  `<message_from user=${JSON.stringify(name)} user_id=${JSON.stringify(userId)} />`

export const make = (
  host: Pick<
    OpenCodeServer.Instance,
    "fetch" | "shells" | "agents" | "skills" | "commands" | "findFiles" | "webSearchProviders"
  >,
): Harness.Chat => {
  const fetch = host.fetch
  const speaking = Semaphore.makeUnsafe(1)
  const call = Effect.fnUntraced(function* (
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: object,
  ): Effect.fn.Return<unknown, Failure> {
    const response = yield* Effect.promise(() =>
      fetch(
        new Request(`http://opencode${path}`, {
          method,
          ...(body && {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
        }),
      ),
    )
    const text = yield* Effect.promise(() => response.text())
    const json = text
      ? yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(text).pipe(Effect.orDie)
      : undefined
    if (response.ok) return json
    const message = Option.match(Schema.decodeUnknownOption(ErrorBody)(json), {
      onNone: () => `OpenCode answered ${response.status} to ${method} ${path}`,
      onSome: (error) => error.message,
    })
    const known = failure(response.status, message)
    if (Option.isSome(known)) return yield* known.value
    return yield* Effect.die(new Error(message))
  })

  const list = <A>(raw: unknown, translate: (item: unknown) => Option.Option<A>) =>
    Effect.gen(function* () {
      const items = (yield* Schema.decodeUnknownEffect(Data)(raw).pipe(Effect.orDie)).data
      return yield* Effect.forEach(items, (item) =>
        Option.match(translate(item), {
          onNone: () =>
            Effect.logWarning("The brain skipped an OpenCode item it cannot read", item).pipe(Effect.as([])),
          onSome: (value) => Effect.succeed([value]),
        }),
      ).pipe(Effect.map((all) => all.flat()))
    })

  const notFoundOnly = <A>(effect: Effect.Effect<A, Failure>) =>
    effect.pipe(
      Effect.catchTag("Harness.Rejected", (error) => Effect.die(new Error(error.message))),
      Effect.catchTag("Harness.Conflict", (error) => Effect.die(new Error(error.message))),
    )

  const session = (raw: unknown) => Translate.session(raw, capabilities)

  const get = (sessionId: Session.ID) =>
    notFoundOnly(call("GET", `/api/session/${sessionId}`)).pipe(
      Effect.flatMap((raw) =>
        Option.match(Option.flatMap(unwrap(raw), session), {
          onNone: () => Effect.die(new Error(`The brain cannot read session ${sessionId}`)),
          onSome: Effect.succeed,
        }),
      ),
    )

  const models = call("GET", "/api/model").pipe(
    Effect.orDie,
    Effect.flatMap((raw) => list(raw, Schema.decodeUnknownOption(Model))),
    Effect.map((all) =>
      all
        .filter((model) => model.enabled)
        .map((model): SessionModel.Info => ({
          id: model.id,
          providerID: model.providerID,
          name: model.name,
          variants: model.variants.map((variant) => ({ id: variant.id })),
          input: model.capabilities.input,
          limit: model.limit,
        })),
    ),
  )

  const lastSpeaker = (sessionId: Session.ID) =>
    Effect.gen(function* () {
      const read = (path: string) =>
        notFoundOnly(call("GET", path)).pipe(
          Effect.flatMap((raw) => Schema.decodeUnknownEffect(Data)(raw).pipe(Effect.orDie)),
        )
      const inbox = yield* read(`/api/session/${sessionId}/inbox`)
      const queued = inbox.data.map((item) => decodeQueued(item)).findLast(Option.isSome)
      if (queued) return Option.fromNullishOr(queued.value.payload.metadata?.userID)
      const latest = yield* read(`/api/session/${sessionId}/message?type=user&limit=1&order=desc`)
      return Option.fromNullishOr(
        latest.data.map((item) => decodeSpoken(item)).find(Option.isSome)?.value.metadata?.userID,
      )
    })

  const active = call("GET", "/api/session/active").pipe(
    Effect.orDie,
    Effect.flatMap(Schema.decodeUnknownEffect(Active)),
    Effect.orDie,
    Effect.map((found) => Object.keys(found.data)),
  )

  return {
    events: OpenCodeEvents.stream(fetch).pipe(
      Stream.mapEffect((raw) =>
        Effect.gen(function* () {
          const translated = Translate.frame(raw, yield* Clock.currentTimeMillis)
          if (Option.isNone(translated) && Translate.isAllowed(raw))
            yield* Effect.logWarning("Skipped an OpenCode event that Ren supports but cannot read", raw)
          return Option.toArray(translated)
        }),
      ),
      Stream.flattenIterable,
    ),
    active: Effect.map(active, (ids) => ids.length > 0),
    status: Effect.map(active, (ids) =>
      Object.fromEntries(ids.map((id): [string, SessionStatus.Info] => [id, { type: "busy" }])),
    ),
    models,
    get,
    children: (sessionId) =>
      Effect.gen(function* () {
        yield* get(sessionId)
        const raw = yield* notFoundOnly(call("GET", `/api/session?parentID=${sessionId}&limit=200`))
        return yield* list(raw, session)
      }),
    messages: (sessionId, page) =>
      Effect.gen(function* () {
        const query = new URLSearchParams({
          ...(page.limit ? { limit: String(page.limit) } : {}),
          ...(page.cursor ? { cursor: page.cursor } : { order: "desc" }),
        })
        const raw = yield* call("GET", `/api/session/${sessionId}/message?${query.toString()}`).pipe(
          Effect.catchTag("Harness.Conflict", (error) => Effect.die(new Error(error.message))),
        )
        const decoded = yield* Schema.decodeUnknownEffect(Page)(raw).pipe(Effect.orDie)
        return {
          items: yield* list({ data: decoded.data }, Translate.message),
          cursor: {
            ...(decoded.cursor.previous && { previous: decoded.cursor.previous }),
            ...(decoded.cursor.next && { next: decoded.cursor.next }),
          },
        } satisfies SessionMessage.Page
      }),
    message: (sessionId, messageId) =>
      notFoundOnly(call("GET", `/api/session/${sessionId}/message/${messageId}`)).pipe(
        Effect.flatMap((raw) =>
          Option.match(Option.flatMap(unwrap(raw), Translate.message), {
            onNone: () => Effect.die(new Error(`The brain cannot read message ${messageId}`)),
            onSome: Effect.succeed,
          }),
        ),
      ),
    inbox: (sessionId) =>
      notFoundOnly(call("GET", `/api/session/${sessionId}/inbox`)).pipe(
        Effect.flatMap((raw) => list(raw, Translate.inbox)),
      ),
    permissions: (sessionId) =>
      notFoundOnly(call("GET", `/api/session/${sessionId}/permission`)).pipe(
        Effect.flatMap((raw) => list(raw, Translate.permission)),
      ),
    forms: (sessionId) =>
      notFoundOnly(call("GET", `/api/session/${sessionId}/form`)).pipe(
        Effect.flatMap((raw) => list(raw, Translate.form)),
      ),
    prompt: (sessionId, prompt) =>
      speaking
        .withPermit(
          Effect.gen(function* () {
            const note = yield* Option.match(prompt.sender, {
              onNone: () => Effect.succeedNone,
              onSome: (sender) => {
                const name = sender.name
                if (!name) return Effect.succeedNone
                return Effect.map(lastSpeaker(sessionId), (last) =>
                  Option.isSome(last) && last.value !== sender.userId
                    ? Option.some(attribution(name, sender.userId))
                    : Option.none(),
                )
              },
            })
            return yield* call("POST", `/api/session/${sessionId}/prompt`, {
              id: prompt.id,
              text: Option.match(note, { onNone: () => prompt.text, onSome: (line) => `${prompt.text}\n\n${line}` }),
              delivery: prompt.delivery,
              ...(Predicate.isBoolean(prompt.resume) && { resume: prompt.resume }),
              ...(prompt.agents && { agents: prompt.agents }),
              ...(prompt.skills && { skills: prompt.skills }),
              ...Option.match(prompt.sender, {
                onNone: () => ({}),
                onSome: (sender) => ({
                  metadata: { userID: sender.userId, ...(Option.isSome(note) && { displayText: prompt.text }) },
                }),
              }),
            })
          }),
        )
        .pipe(
          Effect.asVoid,
          Effect.catchTag("Harness.Rejected", (error) => Effect.die(new Error(error.message))),
          Effect.catchTag("Harness.Conflict", (error) =>
            Effect.gen(function* () {
              const sent = yield* call("GET", `/api/session/${sessionId}/message/${prompt.id}`).pipe(
                Effect.as(true),
                Effect.catchTag("Harness.NotFound", () => Effect.succeed(false)),
                Effect.orDie,
              )
              const queued = (yield* notFoundOnly(call("GET", `/api/session/${sessionId}/inbox`)).pipe(
                Effect.flatMap((raw) => list(raw, Translate.inbox)),
              )).some((item) => item.id === prompt.id)
              if (!sent && !queued) return yield* error
            }),
          ),
        ),
    compact: (sessionId, id) =>
      call("POST", `/api/session/${sessionId}/compact`, { id }).pipe(
        Effect.catchTag("Harness.Rejected", (error) => Effect.die(new Error(error.message))),
        Effect.flatMap((raw) =>
          Option.match(Option.flatMap(unwrap(raw), decodeCompaction), {
            onNone: () => Effect.die(new Error(`The brain cannot read the compaction of session ${sessionId}`)),
            onSome: Effect.succeed,
          }),
        ),
      ),
    interrupt: (sessionId, options) =>
      notFoundOnly(call("POST", `/api/session/${sessionId}/interrupt${options.resume ? "?resume=true" : ""}`)).pipe(
        Effect.asVoid,
      ),
    background: (sessionId) => notFoundOnly(call("POST", `/api/session/${sessionId}/background`)).pipe(Effect.asVoid),
    rename: (sessionId, title) =>
      notFoundOnly(call("PATCH", `/api/session/${sessionId}`, { title })).pipe(Effect.asVoid),
    revert: {
      stage: (sessionId, messageId) =>
        Effect.gen(function* () {
          yield* notFoundOnly(call("POST", `/api/session/${sessionId}/interrupt`))
          yield* notFoundOnly(call("POST", `/api/experimental/session/${sessionId}/wait`))
          const raw = yield* call("POST", `/api/session/${sessionId}/revert/stage`, { messageID: messageId }).pipe(
            Effect.catchTag("Harness.Rejected", (error) => Effect.die(new Error(error.message))),
          )
          return yield* Option.match(Option.flatMap(unwrap(raw), decodeRevert), {
            onNone: () => Effect.die(new Error(`The brain cannot read the revert of session ${sessionId}`)),
            onSome: Effect.succeed,
          })
        }),
      clear: (sessionId) =>
        call("DELETE", `/api/session/${sessionId}/revert`).pipe(
          Effect.asVoid,
          Effect.catchTag("Harness.Rejected", (error) => Effect.die(new Error(error.message))),
        ),
      commit: (sessionId) =>
        call("POST", `/api/session/${sessionId}/revert/commit`).pipe(
          Effect.asVoid,
          Effect.catchTag("Harness.Rejected", (error) => Effect.die(new Error(error.message))),
        ),
    },
    cancelInbox: (sessionId, inboxId) =>
      Effect.gen(function* () {
        yield* notFoundOnly(call("DELETE", `/api/session/${sessionId}/inbox/${inboxId}`))
        const delivered = yield* notFoundOnly(call("GET", `/api/session/${sessionId}/message/${inboxId}`)).pipe(
          Effect.as(true),
          Effect.catchTag("Harness.NotFound", () => Effect.succeed(false)),
        )
        if (delivered)
          return yield* new Harness.Conflict({ message: `The session took input ${inboxId} before it was withdrawn` })
      }),
    updateInbox: (sessionId, inboxId, delivery) =>
      call("PATCH", `/api/session/${sessionId}/inbox/${inboxId}`, { delivery }).pipe(
        Effect.asVoid,
        Effect.catchTag("Harness.Rejected", (error) => Effect.die(new Error(error.message))),
      ),
    command: (sessionId, command) =>
      notFoundOnly(
        call("POST", `/api/session/${sessionId}/command`, {
          name: command.name,
          text: command.text,
          delivery: command.delivery,
          ...(command.agents && { agents: command.agents }),
          ...(command.skills && { skills: command.skills }),
        }),
      ).pipe(Effect.asVoid),
    agents: (sessionId) => host.agents(sessionId).pipe(Effect.flatMap((all) => list({ data: all }, Translate.agent))),
    skills: (sessionId) => host.skills(sessionId).pipe(Effect.flatMap((all) => list({ data: all }, Translate.skill))),
    commands: (sessionId) =>
      host.commands(sessionId).pipe(Effect.flatMap((all) => list({ data: all }, Translate.command))),
    files: (sessionId, search) =>
      host.findFiles(sessionId, search).pipe(Effect.flatMap((all) => list({ data: all }, Translate.file))),
    webSearchProviders: (sessionId) =>
      host
        .webSearchProviders(sessionId)
        .pipe(Effect.map((all) => all.map((provider) => ({ id: provider.id, name: provider.name })))),
    replyPermission: (sessionId, requestId: Permission.RequestID, reply, message) =>
      notFoundOnly(
        call("POST", `/api/session/${sessionId}/permission/${requestId}/reply`, {
          decision: reply,
          ...(message && { message }),
        }),
      ).pipe(Effect.asVoid),
    replyForm: (sessionId, formId: Form.ID, answer) =>
      call("POST", `/api/session/${sessionId}/form/${formId}/reply`, { answer }).pipe(Effect.asVoid),
    cancelForm: (sessionId, formId) =>
      call("DELETE", `/api/session/${sessionId}/form/${formId}`).pipe(
        Effect.asVoid,
        Effect.catchTag("Harness.Rejected", (error) => Effect.die(new Error(error.message))),
      ),
    shells: (sessionId) =>
      host
        .shells(sessionId, (shell) => shell.list())
        .pipe(Effect.flatMap((all) => list({ data: all }, Translate.shell))),
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
