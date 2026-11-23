import { afterAll, expect, setDefaultTimeout, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { Model, Provider } from "@opencode/plugin/effect"
import type { Route, ToastOptions } from "@opencode/plugin/tui/context"
import { OpenCodeHost, Shared } from "@ren/cell/testing"
import { BrainTest } from "@ren/cell/testing/brain"
import { Session } from "@ren/schema/session"
import { Effect, Schema } from "effect"
import { RenCommands } from "../src/commands.js"
import { RenRpc } from "../src/rpc.js"
import { RenServer } from "./lib/ren.js"

setDefaultTimeout(90_000)

afterAll(Shared.dispose)

process.env["REN_TOKEN"] = "user-token"

test("/ren:move moves a local session with a local answer and an unanswered message to a real brain, which restores it; the next message's execution answers the unanswered message, then the new one, with the whole history", () =>
  Effect.gen(function* () {
    const stub = Shared.stub()
    const target: { brain?: Effect.Success<ReturnType<typeof BrainTest.make>> } = {}
    const ren = yield* RenServer.make({
      chat: (path, request) =>
        target.brain ? target.brain.chatFetch(path, request) : Promise.resolve(new Response(null, { status: 503 })),
      imported: (_id, transcript) =>
        target.brain
          ? Effect.runPromise(
              target.brain.restoreExport(transcript).pipe(Effect.andThen(target.brain.start()), Effect.asVoid),
            )
          : Promise.reject(new Error("No brain")),
    })
    const host = yield* OpenCodeHost.make({
      ...Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(
        Shared.vars(stub.url).OPENCODE_CONFIG,
      ),
      plugins: [{ package: fileURLToPath(new URL("..", import.meta.url)), options: { url: ren.url } }],
    })
    const session = yield* host.client.session
      .create({
        location: host.location,
        title: "Fix the login loop",
        model: { providerID: Provider.ID.make("stub"), id: Model.ID.make("stub-model") },
      })
      .pipe(Effect.orDie)
    const sessionID = session.id
    target.brain = yield* BrainTest.make({ id: Session.ID.make(sessionID) })
    const local = stub.script({ reply: "The loop is in auth.ts line 42." })
    yield* host.client.session.prompt({ sessionID, text: `Why does login loop? ${local.marker}` }).pipe(Effect.orDie)
    yield* host.client.experimental.session.wait({ sessionID }).pipe(Effect.orDie)
    const unanswered = yield* host.client.session
      .prompt({ sessionID, text: "Also check the refresh token.", resume: false })
      .pipe(Effect.orDie)

    const toasts: Array<ToastOptions> = []
    const route: Route = { type: "session", sessionID }
    yield* Effect.promise(() =>
      RenCommands.move({
        client: host.promise,
        location: () => host.location,
        ui: {
          dialog: { select: () => Promise.resolve(undefined), confirm: () => Promise.resolve(true) },
          toast: { show: (toast) => toasts.push(toast) },
          router: { navigate: () => undefined, current: () => route },
          model: { current: () => ({ providerID: "ren", modelID: "stub/stub-model" }) },
        },
      }),
    )
    expect(toasts.at(-1)).toEqual({ message: "Moved to Ren space Alpha", variant: "success" })

    const next = stub.script({ reply: "Fixed both." })
    const sent = yield* host.client.session.prompt({ sessionID, text: `Go on. ${next.marker}` }).pipe(Effect.orDie)
    yield* host.client.experimental.session.wait({ sessionID }).pipe(Effect.orDie)

    const call = yield* Effect.promise(() => next.called())
    const history = JSON.stringify(call.body.messages)
    expect(
      ["auth.ts line 42", "Also check the refresh token.", "Go on."].map((text) => history.includes(text)),
    ).toEqual([true, true, true])
    expect(ren.state.created).toEqual([])
    const remote = yield* target.brain.chat.session["session.messages"]({
      params: { sessionID: target.brain.id },
      query: {},
    })
    const users = remote.items.filter((message) => message.type === "user").map((message) => String(message.id))
    const locals = (yield* host.client.session.context({ sessionID }).pipe(Effect.orDie)).filter(
      (message) => message.type === "user",
    )
    expect(users.toSorted()).toEqual(locals.map((message) => String(message.id)).toSorted())
    expect(users).toContain(String(unanswered.id))
    expect(users).toContain(String(sent.id))
    const order = remote.items.toReversed().map((message) => String(message.id))
    const between = remote.items
      .toReversed()
      .slice(order.indexOf(String(unanswered.id)) + 1, order.indexOf(String(sent.id)))
    expect(between.map((message) => message.type)).toEqual(["assistant"])
    const answer = (yield* host.client.session.context({ sessionID }).pipe(Effect.orDie)).findLast(
      (message) => message.type === "assistant",
    )
    expect(
      answer?.type === "assistant" && answer.content.flatMap((part) => (part.type === "text" ? [part.text] : [])),
    ).toEqual(["stub reply", "Fixed both."])
  }).pipe(Effect.scoped, Effect.runPromise))

test("moveSession refuses a transcript over Ren's import limit before it reaches Ren, and a session that is already a Ren session", () =>
  Effect.gen(function* () {
    const ren = yield* RenServer.make()
    const host = yield* OpenCodeHost.make({
      plugins: [{ package: fileURLToPath(new URL("..", import.meta.url)), options: { url: ren.url } }],
    })
    const opened = { host, rpc: host.client.rpc(RenRpc.Definition), at: { location: host.location } }
    const local = yield* opened.host.client.session.create({ location: opened.host.location }).pipe(Effect.orDie)
    const large = yield* opened.rpc
      .moveSession(
        { sessionID: local.id, transcript: { info: { id: local.id }, padding: "x".repeat(Session.maxImportBytes) } },
        opened.at,
      )
      .pipe(Effect.flip)
    const created = yield* opened.rpc.createSession({}, opened.at)
    const bound = yield* opened.rpc
      .moveSession({ sessionID: created.sessionID, transcript: { messages: [] } }, opened.at)
      .pipe(Effect.flip)
    expect([large, bound]).toEqual([
      { type: "unavailable", message: "This session is 33 MiB. Ren moves a session of at most 32 MiB.", data: {} },
      {
        type: "unavailable",
        message: "This session is already a Ren session. Send a message to start it in Ren.",
        data: {},
      },
    ])
    expect(ren.state.imported).toEqual([])
  }).pipe(Effect.scoped, Effect.runPromise))
