import { afterAll, expect, setDefaultTimeout, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Destination } from "@opencode/plugin/tui/context"
import { OpenCodeHost, Shared } from "@ren/cell/testing"
import { BrainTest } from "@ren/cell/testing/brain"
import { Session } from "@ren/schema/session"
import { SessionCapabilities } from "@ren/schema/session/capabilities"
import { SessionMessage } from "@ren/schema/session/message"
import { DateTime, Effect, type Scope } from "effect"
import { Binding } from "../src/binding.js"
import { RenCommands } from "../src/commands.js"
import { RenServer } from "./lib/ren.js"

setDefaultTimeout(60_000)

afterAll(Shared.dispose)

process.env["REN_TOKEN"] = "user-token"

const plugin = fileURLToPath(new URL("..", import.meta.url))

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => body.pipe(Effect.scoped, Effect.runPromise)

type Brain = Effect.Success<ReturnType<typeof BrainTest.make>>

const host = Effect.fnUntraced(function* (ren: Effect.Success<ReturnType<typeof RenServer.make>>, database: string) {
  const opened = yield* OpenCodeHost.make({ plugins: [{ package: plugin, options: { url: ren.url } }] }, { database })
  const routes: Array<Destination> = []
  const toasts: Array<string> = []
  const surface: RenCommands.OpenSurface = {
    client: opened.promise,
    reload: (_sessionID, load) => load().then(() => undefined),
    location: () => opened.location,
    ui: {
      dialog: {
        select: () => Promise.resolve(undefined),
        prompt: () => Promise.resolve(undefined),
        confirm: () => Promise.resolve(false),
      },
      toast: { show: (toast) => toasts.push(toast.message) },
      router: { navigate: (destination) => routes.push(destination), current: () => ({ type: "home" }) },
      model: { current: () => undefined },
    },
  }
  const messages = (sessionID: string) =>
    opened.client.session.context({ sessionID: Binding.LocalID.make(sessionID) }).pipe(Effect.orDie)
  const transcript = (sessionID: string) =>
    Effect.map(messages(sessionID), (all) =>
      all.flatMap((message) => {
        if (message.type === "user") return [`user:${message.text}`]
        if (message.type !== "assistant") return []
        return [
          message.content
            .map((part) => {
              if (part.type === "tool") return `[${part.name}]`
              return part.type === "text" ? part.text : ""
            })
            .join(""),
        ]
      }),
    )
  return { ...opened, routes, toasts, surface, messages, transcript }
})

const remote = (brain: Brain) =>
  brain.chat.session["session.messages"]({ params: { sessionID: brain.id }, query: {} }).pipe(
    Effect.map((page) => page.items.toReversed()),
  )

test("a Ren session started and answered by another client, with a tool call, opens in a fresh OpenCode with its whole transcript, continues there, and catches up with what happened while OpenCode was closed", () =>
  run(
    Effect.gen(function* () {
      const target: { brain?: Brain; member?: { readonly sub: string; readonly name: string } } = {}
      const ren = yield* RenServer.make({
        chat: (path, request) =>
          target.brain
            ? target.brain.chatFetch(path, request, target.member)
            : Promise.resolve(new Response(null, { status: 503 })),
        saved: (sessionId, url) =>
          target.brain
            ? target.brain.chatFetch(`/chat/session/${sessionId}/message${url.search}`, {}, target.member)
            : Promise.resolve(new Response(null, { status: 503 })),
      })
      target.member = { sub: ren.state.me.id, name: ren.state.me.name }
      const id = Session.ID.create()
      const brain = yield* BrainTest.make({ id })
      target.brain = brain
      yield* brain.start()
      ren.state.sessions.push({
        id,
        spaceId: ren.state.spaceId,
        createdBy: ren.state.bea.id,
        agentId: null,
        origin: "chat",
        harness: "opencode",
        title: null,
        status: "idle",
        capabilities: SessionCapabilities.of("opencode"),
        createdAt: DateTime.nowUnsafe(),
        updatedAt: DateTime.nowUnsafe(),
        archivedAt: null,
        filesResetAt: null,
      })
      const bea = yield* brain.chatAs({ sub: ren.state.bea.id, name: ren.state.bea.name })
      const ask = (text: string) =>
        bea.session["session.prompt"]({
          params: { sessionID: id },
          payload: { id: SessionMessage.ID.create(), text, delivery: "steer" },
        }).pipe(Effect.andThen(brain.opencode.experimental.session.wait({ sessionID: Binding.LocalID.make(id) })))
      const child = Shared.stub().script({ reply: "Looked." })
      const planned = Shared.stub().script({
        tools: [{ name: "subagent", input: { agent: "explore", description: "Look", prompt: `${child.marker} look` } }],
        reply: "Planned.",
      })
      yield* ask(`plan ${planned.marker}`)

      const database = join(mkdtempSync(join(tmpdir(), "ren-open-")), "opencode.db")
      yield* Effect.scoped(
        Effect.gen(function* () {
          const ada = yield* host(ren, database)
          yield* Effect.promise(() => RenCommands.open(ada.surface, id))
          expect(ada.toasts).toEqual([])
          expect(ada.routes).toEqual([{ type: "session", sessionID: id }])
          expect(yield* ada.transcript(id)).toEqual([`user:Bea: plan ${planned.marker}`, "[subagent]", "Planned."])
          const tool = (messages: ReadonlyArray<{ readonly type: string; readonly content?: unknown }>) =>
            messages.flatMap((message) =>
              message.type === "assistant" && Array.isArray(message.content)
                ? message.content.filter((part) => part.type === "tool")
                : [],
            )
          const brainTool = tool(yield* remote(brain)).at(0)
          expect(brainTool?.state.metadata).toMatchObject({ status: "completed" })
          expect(tool(yield* ada.messages(id)).at(0)).toMatchObject({
            name: "subagent",
            state: { status: "completed", metadata: brainTool?.state.metadata },
          })

          const continued = Shared.stub().script({ reply: "Continued here." })
          const sessionID = Binding.LocalID.make(id)
          const sent = yield* ada.client.session.prompt({ sessionID, text: continued.marker }).pipe(Effect.orDie)
          yield* ada.client.experimental.session.wait({ sessionID }).pipe(Effect.orDie)
          expect((yield* ada.transcript(id)).slice(-2)).toEqual([`user:${continued.marker}`, "Continued here."])
          expect((yield* remote(brain)).some((message) => message.id === String(sent.id))).toBe(true)
        }),
      )

      const later = Shared.stub().script({ reply: "Done while you were away." })
      yield* ask(later.marker)

      const back = yield* host(ren, database)
      yield* Effect.promise(() => RenCommands.catchUp(back.surface, id))
      expect((yield* back.transcript(id)).slice(-2)).toEqual([`user:Bea: ${later.marker}`, "Done while you were away."])
      expect((yield* back.messages(id)).map((message) => String(message.id))).toEqual(
        (yield* remote(brain)).map((message) => message.id),
      )
      expect(ren.state.renames).toEqual([])
    }),
  ))
