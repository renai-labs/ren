export * as OpenCodeChat from "./chat.js"

import type { Form } from "@ren/schema/form"
import type { Permission } from "@ren/schema/permission"
import type { Session } from "@ren/schema/session"
import { SessionCapabilities } from "@ren/schema/session-capabilities"
import type { SessionMessage } from "@ren/schema/session-message"
import { SessionModel } from "@ren/schema/session-model"
import type { SessionStatus } from "@ren/schema/session-status"
import { Effect, Option, Schema, Stream } from "effect"
import { Harness } from "../harness.js"
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

export const make = (fetch: (request: Request) => Promise<Response>): Harness.Chat => {
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

  const active = call("GET", "/api/session/active").pipe(
    Effect.orDie,
    Effect.flatMap(Schema.decodeUnknownEffect(Active)),
    Effect.orDie,
    Effect.map((found) => Object.keys(found.data)),
  )

  return {
    events: OpenCodeEvents.stream(fetch).pipe(
      Stream.map(Translate.event),
      Stream.filter(Option.isSome),
      Stream.map((event) => event.value),
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
      call("POST", `/api/session/${sessionId}/prompt`, {
        id: prompt.id,
        text: prompt.text,
        delivery: prompt.delivery,
        ...Option.match(prompt.sender, {
          onNone: () => ({}),
          onSome: (sender) => ({ metadata: { userID: sender.userId } }),
        }),
      }).pipe(
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
    interrupt: (sessionId) => notFoundOnly(call("POST", `/api/session/${sessionId}/interrupt`)).pipe(Effect.asVoid),
    switchModel: (sessionId, model) =>
      Effect.gen(function* () {
        const known = (yield* models).find(
          (candidate) =>
            candidate.id === model.id &&
            candidate.providerID === model.providerID &&
            (!model.variant || candidate.variants.some((variant) => variant.id === model.variant)),
        )
        if (!known)
          return yield* new Harness.Rejected({
            message: `The session cannot use ${SessionModel.key(model)}${model.variant ? `#${model.variant}` : ""}`,
          })
        yield* call("POST", `/api/session/${sessionId}/model`, { model }).pipe(
          Effect.catchTag("Harness.Conflict", (error) => Effect.die(new Error(error.message))),
        )
      }),
    replyPermission: (sessionId, requestId: Permission.RequestID, reply) =>
      notFoundOnly(call("POST", `/api/session/${sessionId}/permission/${requestId}/reply`, { decision: reply })).pipe(
        Effect.asVoid,
      ),
    replyForm: (sessionId, formId: Form.ID, answer) =>
      call("POST", `/api/session/${sessionId}/form/${formId}/reply`, { answer }).pipe(Effect.asVoid),
    cancelForm: (sessionId, formId) =>
      call("DELETE", `/api/session/${sessionId}/form/${formId}`).pipe(
        Effect.asVoid,
        Effect.catchTag("Harness.Rejected", (error) => Effect.die(new Error(error.message))),
      ),
  }
}
