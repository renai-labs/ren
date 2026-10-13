export * as OpenCodeHarness from "./harness.js"

import { OpenCode, Session } from "@opencode/client/effect"
import type { SessionListInput } from "@opencode/client/effect/api"
import { Clock, Effect, Option, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import { Host } from "./host.js"

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
  }
})
