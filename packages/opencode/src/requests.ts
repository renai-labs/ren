export * as Requests from "./requests.js"

import type { Plugin } from "@opencode/plugin/effect"
import type { Form } from "@ren/schema/form"
import type { Permission } from "@ren/schema/permission"
import { Session } from "@ren/schema/session"
import type { SessionEvent } from "@ren/schema/session/event"
import { Cause, Context, Deferred, Effect, Exit, Layer, Option, PubSub, Schema, type Scope, Stream } from "effect"
import { Binding } from "./binding.js"
import { Link } from "./link.js"
import type { RenRpc } from "./rpc.js"

export type Change =
  | { readonly type: "formAsked"; readonly form: RenRpc.LocalForm }
  | { readonly type: "requestClosed"; readonly closed: RenRpc.Closed }

type LocalRequestID = Parameters<Plugin.Context["permission"]["reply"]>[0]["requestID"]

interface Asked {
  readonly request: Permission.Request
  readonly root: Session.ID
  readonly replied: Deferred.Deferred<Permission.Reply>
  local?: LocalRequestID
  state: "pending" | "answered" | "closed"
}

interface Question {
  readonly form: Form.Info
  readonly root: Session.ID
  state: "open" | "expired" | "closed"
}

export class Service extends Context.Service<
  Service,
  {
    readonly frame: (sessionId: Session.ID, frame: SessionEvent.Frame) => Effect.Effect<void>
    readonly pending: Effect.Effect<{
      readonly forms: ReadonlyArray<RenRpc.LocalForm>
      readonly closed: ReadonlyArray<RenRpc.FormRef>
    }>
    readonly changes: Effect.Effect<Stream.Stream<Change>, never, Scope.Scope>
  }
>()("@ren/opencode/Requests") {}

const suffix = " (on Ren)"

const Marker = Schema.Struct({ ren: Schema.Struct({ requestID: Schema.String }) })

const Corrected = Schema.Struct({ error: Schema.Struct({ _tag: Schema.Literal("Permission.CorrectedError") }) })

const verbs = { once: "allowed", always: "allowed", reject: "rejected" }

export const layer = (ctx: Pick<Plugin.Context, "permission" | "event" | "session">) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const links = yield* Link.Service
      const scope = yield* Effect.scope
      const hub = yield* PubSub.unbounded<Change>()
      const asked = new Map<string, Asked>()
      const locals = new Map<string, Asked>()
      const questions = new Map<string, Question>()
      const shown = new Set<string>()

      const chat = (root: Session.ID) => Effect.flatMap(links.open(root), (link) => link.client)

      const local = (question: Question): RenRpc.LocalForm => ({
        sessionID: question.root,
        id: question.form.id,
        title: question.form.title,
        metadata: {
          ren: { sessionID: question.form.sessionID, ...(question.form.kind && { kind: question.form.kind }) },
        },
        fields: question.form.fields,
      })

      const closeLocal = (entry: Asked) =>
        entry.local
          ? ctx.permission
              .reply({ sessionID: Binding.LocalID.make(entry.root), requestID: entry.local, decision: "once" })
              .pipe(Effect.ignore)
          : Effect.void

      const settle = Effect.fnUntraced(function* (entry: Asked | undefined, reply: Permission.Reply | undefined) {
        if (entry?.state !== "pending") return
        entry.state = "closed"
        yield* closeLocal(entry)
        yield* PubSub.publish(hub, {
          type: "requestClosed",
          closed: {
            sessionID: entry.root,
            id: entry.request.id,
            kind: "permission",
            message: `${[entry.request.action, ...entry.request.resources].join(" ")} was ${reply ? verbs[reply] : "closed"} on Ren.`,
          },
        })
      })

      const answer = Effect.fnUntraced(function* (entry: Asked) {
        const exit = yield* ctx.permission
          .assert({
            sessionID: Binding.LocalID.make(entry.root),
            action: entry.request.action,
            resources: entry.request.resources,
            ...(entry.request.save?.length && { save: entry.request.save.map((pattern) => `${pattern}${suffix}`) }),
            metadata: {
              ...entry.request.metadata,
              ren: { requestID: entry.request.id, sessionID: entry.request.sessionID },
            },
          })
          .pipe(Effect.exit)
        if (entry.state !== "pending") return
        const failure = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : Option.none()
        if (Option.isSome(failure) && !Schema.is(Corrected)(failure.value))
          return yield* Effect.logWarning(
            "A Ren permission request cannot show here because a local rule denies it; answer it in another Ren client",
            failure.value,
          )
        entry.state = "answered"
        const reply = Exit.isSuccess(exit) ? yield* Deferred.await(entry.replied) : "reject"
        const client = yield* chat(entry.root)
        yield* client.session.permission
          .reply({
            sessionID: entry.request.sessionID,
            requestID: entry.request.id,
            reply,
            ...(Option.isSome(failure) && { message: failure.value.message }),
          })
          .pipe(Effect.catchTag("NotFoundError", () => Effect.void))
      }, Effect.scoped)

      const ask = Effect.fnUntraced(function* (root: Session.ID, request: Permission.Request) {
        if (asked.has(request.id)) return
        const entry: Asked = { request, root, replied: yield* Deferred.make<Permission.Reply>(), state: "pending" }
        asked.set(request.id, entry)
        yield* answer(entry).pipe(
          Effect.catchCause((cause) => Effect.logWarning("Could not answer a Ren permission request", cause)),
          Effect.ensuring(
            Effect.sync(() => {
              asked.delete(request.id)
              if (entry.local) locals.delete(entry.local)
            }),
          ),
          Effect.forkIn(scope),
        )
      })

      const open = Effect.fnUntraced(function* (root: Session.ID, form: Form.Info) {
        if (questions.has(form.id)) return
        const question: Question = { form, root, state: "open" }
        questions.set(form.id, question)
        yield* PubSub.publish(hub, { type: "formAsked", form: local(question) })
      })

      const close = Effect.fnUntraced(function* (question: Question, verb: string) {
        if (question.state === "closed") return
        question.state = "closed"
        if (!shown.has(question.form.id)) {
          questions.delete(question.form.id)
          return
        }
        yield* PubSub.publish(hub, {
          type: "requestClosed",
          closed: {
            sessionID: question.root,
            id: question.form.id,
            kind: "form",
            message: `${question.form.title} was ${verb} on Ren.`,
          },
        })
      })

      const sync = Effect.fnUntraced(function* (root: Session.ID) {
        const client = yield* chat(root)
        const info = yield* client.session.get({ sessionID: root })
        const children = yield* client.session.children({ sessionID: root })
        const sessions = [root, ...children.map((child) => child.id)]
        const permissions = info.capabilities.permissions
          ? (yield* Effect.forEach(sessions, (sessionID) => client.session.permission.list({ sessionID }))).flat()
          : []
        const forms = info.capabilities.forms
          ? (yield* Effect.forEach(sessions, (sessionID) => client.session.form.list({ sessionID }))).flat()
          : []
        yield* Effect.forEach(
          [...asked.values()].filter(
            (entry) => entry.root === root && !permissions.some((request) => request.id === entry.request.id),
          ),
          (entry) => settle(entry, undefined),
          { discard: true },
        )
        yield* Effect.forEach(
          [...questions.values()].filter(
            (question) =>
              question.root === root &&
              question.state === "open" &&
              !forms.some((form) => form.id === question.form.id),
          ),
          (question) => close(question, "closed"),
          { discard: true },
        )
        yield* Effect.forEach(permissions, (request) => ask(root, request), { discard: true })
        yield* Effect.forEach(forms, (form) => open(root, form), { discard: true })
      }, Effect.scoped)

      const reply = Effect.fnUntraced(function* (question: Question, answer: Form.Answer) {
        if (question.state === "open") {
          question.state = "closed"
          const client = yield* chat(question.root)
          const gone = yield* client.session.form
            .reply({ sessionID: Session.ID.make(question.form.sessionID), formID: question.form.id, answer })
            .pipe(
              Effect.as(false),
              Effect.catchTags({
                NotFoundError: () => Effect.succeed(true),
                ConflictError: () => Effect.succeed(true),
              }),
            )
          if (!gone || question.form.kind !== "question") return
        } else if (question.state !== "expired") return
        yield* ctx.session.prompt({
          sessionID: Binding.LocalID.make(question.root),
          text: [
            `An answer to an earlier question, "${question.form.title}":`,
            ...question.form.fields.map((field) => {
              const value = answer[field.key]
              const text = Array.isArray(value) ? value.join(", ") : String(value ?? "")
              return [
                ...[field.title ?? field.key, ...(field.description ? [field.description] : [])].map(
                  (line) => `> ${line}`,
                ),
                text,
              ].join("\n")
            }),
          ].join("\n\n"),
          resume: true,
        })
      }, Effect.scoped)

      const dismiss = Effect.fnUntraced(function* (question: Question) {
        if (question.state !== "open") return
        question.state = "closed"
        const client = yield* chat(question.root)
        yield* client.session.form
          .cancel({ sessionID: Session.ID.make(question.form.sessionID), formID: question.form.id })
          .pipe(Effect.catchTags({ NotFoundError: () => Effect.void, ConflictError: () => Effect.void }))
      }, Effect.scoped)

      yield* ctx.permission.hook("evaluate", (event) =>
        Effect.sync(() => {
          if (Schema.is(Marker)(event.metadata)) event.effect = "ask"
        }),
      )

      yield* ctx.event
        .subscribe({
          types: ["permission.asked", "permission.replied", "form.created", "form.replied", "form.cancelled"],
        })
        .pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              if (event.type === "permission.asked") {
                const marker = Schema.decodeUnknownOption(Marker)(event.data.metadata)
                const entry = Option.isSome(marker) ? asked.get(marker.value.ren.requestID) : undefined
                if (!entry) return
                entry.local = event.data.id
                locals.set(event.data.id, entry)
                if (entry.state === "closed") yield* closeLocal(entry)
                return
              }
              if (event.type === "permission.replied") {
                const entry = locals.get(event.data.requestID)
                if (entry) yield* Deferred.succeed(entry.replied, event.data.reply)
                return
              }
              if (event.type === "form.created") {
                const question = questions.get(event.data.form.id)
                if (!question) return
                shown.add(question.form.id)
                if (question.state === "closed") {
                  question.state = "open"
                  yield* close(question, "closed")
                }
                return
              }
              const question = questions.get(event.data.id)
              shown.delete(event.data.id)
              if (!question) return
              questions.delete(event.data.id)
              if (event.type === "form.replied") return yield* reply(question, event.data.answer)
              yield* dismiss(question)
            }).pipe(Effect.catchCause((cause) => Effect.logWarning("Could not answer a Ren request", cause))),
          ),
          Effect.catchCause((cause) => Effect.logWarning("Local answers no longer reach Ren", cause)),
          Effect.forkScoped,
        )

      return Service.of({
        frame: (root, frame) =>
          Effect.gen(function* () {
            if (frame.type === "server.connected") return yield* sync(root)
            if (frame.type === "permission.asked") return yield* ask(root, frame.data)
            if (frame.type === "permission.replied")
              return yield* settle(asked.get(frame.data.requestID), frame.data.reply)
            if (frame.type === "form.created") return yield* open(root, frame.data.form)
            if (frame.type !== "form.replied" && frame.type !== "form.cancelled") return
            const question = questions.get(frame.data.id)
            if (question?.state !== "open") return
            if (frame.type === "form.cancelled" && question.form.kind === "question") {
              question.state = "expired"
              return
            }
            yield* close(question, frame.type === "form.replied" ? "answered" : "dismissed")
          }).pipe(Effect.catchCause((cause) => Effect.logWarning("Could not follow a Ren request", cause))),
        pending: Effect.sync(() => ({
          forms: [...questions.values()].filter((question) => question.state !== "closed").map(local),
          closed: [...questions.values()]
            .filter((question) => question.state === "closed" && shown.has(question.form.id))
            .map((question) => ({ sessionID: question.root, formID: question.form.id })),
        })),
        changes: Effect.map(PubSub.subscribe(hub), Stream.fromSubscription),
      })
    }),
  )
