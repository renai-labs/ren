export * as OpenCodeHarness from "./harness.js"

import { AbsolutePath, Agent, Model, OpenCode, Provider, Session, SessionMessage } from "@opencode/client/effect"
import type { OpenCodeClient } from "@opencode/client/effect"
import type { SessionListInput } from "@opencode/client/effect/api"
import type { Credential } from "@opencode/core/credential"
import { BrainRejectedError, SessionNotStartedError } from "@ren/brain-api/errors"
import type { SendInput, StartInput } from "@ren/schema/session"
import { Clock, Effect, Option, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import type { Harness } from "../harness.js"
import { Credentials } from "./credentials.js"
import { Host } from "./host.js"
import { InstructionEntries } from "./instruction-entries.js"

const find = (client: OpenCodeClient, sessionID: Session.ID) =>
  client.session.get({ sessionID }).pipe(
    Effect.map(Option.some),
    Effect.catchTag("SessionNotFoundError", () => Effect.succeed(Option.none())),
    Effect.orDie,
  )

const known = Effect.fn("OpenCodeHarness.known")(function* (client: OpenCodeClient, input: StartInput) {
  const agent = input.agent
  if (agent && !(yield* client.agent.list().pipe(Effect.orDie)).data.some((item) => item.id === agent))
    return yield* new BrainRejectedError({ message: `Unknown agent: ${agent}` })
  const model = input.model
  if (
    model &&
    !(yield* client.model.list().pipe(Effect.orDie)).data.some(
      (item) => item.providerID === model.providerId && item.modelID === model.modelId,
    )
  )
    return yield* new BrainRejectedError({ message: `Unknown model: ${model.providerId}/${model.modelId}` })
})

const start = Effect.fn("OpenCodeHarness.start")(function* (
  client: OpenCodeClient,
  store: Credential.Interface,
  input: StartInput,
) {
  yield* Credentials.apply(client, store, input.credentials, "replace")
  yield* known(client, input)
  const agent = input.agent ? Agent.ID.make(input.agent) : undefined
  const wanted = input.model
  const model = wanted && {
    providerID: Provider.ID.make(wanted.providerId),
    id: Model.ID.make(wanted.modelId),
    ...(wanted.variant && { variant: Model.VariantID.make(wanted.variant) }),
  }
  const sessionID = Session.ID.make(input.sessionId)
  const permissions = input.interactive ? [] : [{ action: "question", resource: "*", effect: "deny" as const }]
  const existing = yield* find(client, sessionID)
  if (Option.isNone(existing))
    yield* client.session
      .create({
        id: sessionID,
        title: input.title,
        agent,
        model,
        location: { directory: AbsolutePath.make("/workspace") },
        permissions,
      })
      .pipe(Effect.orDie)
  if (Option.isSome(existing)) {
    yield* client.session.update({ sessionID, title: input.title, permissions }).pipe(Effect.orDie)
    if (agent && agent !== existing.value.agent)
      yield* client.session.switchAgent({ sessionID, agent }).pipe(Effect.orDie)
    if (model) yield* client.session.switchModel({ sessionID, model }).pipe(Effect.orDie)
  }
  const changes = InstructionEntries.changes(
    yield* client.session.instructions.entry.list({ sessionID }).pipe(Effect.orDie),
    input.instructions,
  )
  yield* Effect.forEach(
    changes.put,
    (entry) => client.session.instructions.entry.put({ sessionID, key: entry.key, value: entry.value }),
    { discard: true },
  ).pipe(Effect.orDie)
  yield* Effect.forEach(changes.remove, (key) => client.session.instructions.entry.remove({ sessionID, key }), {
    discard: true,
  }).pipe(Effect.orDie)
  return { sessionId: input.sessionId, harness: "opencode" as const }
})

const send = Effect.fn("OpenCodeHarness.send")(function* (
  client: OpenCodeClient,
  store: Credential.Interface,
  input: SendInput,
) {
  const sessionID = Session.ID.make(input.sessionId)
  if (Option.isNone(yield* find(client, sessionID)))
    return yield* new SessionNotStartedError({ message: `Session ${input.sessionId} has not been started` })
  if (input.credentials) yield* Credentials.apply(client, store, input.credentials, "merge")
  const messageID = SessionMessage.ID.make(input.messageId)
  const sent = yield* client.session.message.get({ sessionID, messageID }).pipe(
    Effect.as(true),
    Effect.catchTag("MessageNotFoundError", () => Effect.succeed(false)),
    Effect.orDie,
  )
  if (sent) return { messageId: input.messageId }
  yield* client.session
    .prompt({
      sessionID,
      id: messageID,
      text: input.prompt.text,
      files: input.prompt.files?.map((file) => ({ uri: file.url, name: file.name })),
      delivery: input.delivery,
      metadata: { userID: input.sender.userId },
    })
    .pipe(Effect.orDie)
  return { messageId: input.messageId }
})

export const open = Effect.fn("OpenCodeHarness.open")(function* (storage: DurableObjectStorage, config: string) {
  const host = yield* Host.open(storage, config)
  const client = yield* OpenCode.make({ baseUrl: "http://opencode" }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, (input, init) => host.fetch(new Request(input, init))),
  )
  const state = { asked: new Map<string, number>() }

  return {
    fetch: host.fetch,
    close: host.close,
    start: (input: StartInput) => start(client, host.credentials, input),
    send: (input: SendInput) => send(client, host.credentials, input),
    sessions: Effect.gen(function* () {
      const roots = yield* Stream.paginate(undefined, (cursor: SessionListInput["cursor"]) =>
        client.session.list({ parentID: null, cursor }).pipe(
          Effect.orDie,
          Effect.map((page) => [page.data, Option.fromNullishOr(page.cursor.next)] as const),
        ),
      ).pipe(Stream.runCollect)
      const read = yield* Effect.forEach(roots, (info) =>
        Effect.gen(function* () {
          const inbox = yield* client.session.inbox.list({ sessionID: info.id }).pipe(Effect.orDie)
          const last = yield* Stream.paginate(undefined, (cursor: string | undefined) =>
            client.message.list({ sessionID: info.id, limit: 50, ...(cursor ? { cursor } : { order: "desc" }) }).pipe(
              Effect.orDie,
              Effect.map((page) => [page.data, Option.fromNullishOr(page.cursor.next)] as const),
            ),
          ).pipe(
            Stream.filter(
              (message) => message.type === "idle" || message.type === "user" || message.type === "synthetic",
            ),
            Stream.runHead,
          )
          return { id: info.id, inbox, unfinished: Option.isSome(last) && last.value.type !== "idle" }
        }),
      )
      const active = Object.keys(yield* client.session.active().pipe(Effect.orDie)).map((id) => Session.ID.make(id))
      const forms = yield* Effect.forEach(active, (sessionID) =>
        client.session.form.list({ sessionID }).pipe(Effect.orDie),
      ).pipe(Effect.map((lists) => lists.flat()))
      const now = yield* Clock.currentTimeMillis
      state.asked = new Map(forms.map((form) => [form.id, state.asked.get(form.id) ?? now]))
      return [
        ...read,
        ...active
          .filter((id) => !read.some((session) => session.id === id))
          .map((id) => ({ id, inbox: [], unfinished: false })),
      ].map((session) => {
        const waited = forms
          .filter((form) => form.sessionID === session.id)
          .map((form) => now - (state.asked.get(form.id) ?? now))
        return {
          id: session.id,
          active: active.includes(session.id),
          unfinished: session.unfinished,
          askedMs: waited.reduce<number | undefined>((longest, ms) => Math.max(longest ?? ms, ms), undefined),
          inbox: session.inbox,
          resend: Effect.fn("OpenCodeHarness.resend")(function* (id: string) {
            const item = session.inbox.find((entry) => entry.id === id)
            if (item?.type !== "user") return
            yield* client.session
              .prompt({
                sessionID: item.sessionID,
                id: item.id,
                delivery: item.delivery,
                text: item.payload.text,
                resume: true,
              })
              .pipe(Effect.orDie)
          }),
          wait: (ms: number) => client.session.wait({ sessionID: session.id }).pipe(Effect.timeout(ms), Effect.ignore),
          interrupt: client.session.interrupt({ sessionID: session.id }).pipe(Effect.orDie, Effect.asVoid),
        }
      })
    }),
  } satisfies Harness.Instance
})
