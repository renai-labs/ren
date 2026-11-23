export * as RenServer from "./ren.js"

import { Auth } from "@ren/schema/auth"
import { Session } from "@ren/schema/session"
import { SessionCapabilities } from "@ren/schema/session/capabilities"
import type { SessionEvent } from "@ren/schema/session/event"
import { SessionMessage } from "@ren/schema/session/message"
import { SessionModel } from "@ren/schema/session/model"
import { Space } from "@ren/schema/space"
import { DateTime, Effect, Queue, Schema } from "effect"

export interface Prompt {
  readonly sessionID: string
  readonly id: string
  readonly text: string
  readonly delivery: string
}

export interface Options {
  readonly chat?: (path: string, request: Request) => Promise<Response>
  readonly created?: (sessionId: Session.ID) => Promise<void>
}

const Created = Schema.Struct({ id: Session.ID, spaceId: Space.ID, model: Schema.optional(SessionModel.Ref) })
const Prompted = Schema.Struct({ id: Schema.String, text: Schema.String, delivery: Schema.String })

const choices: SessionModel.Choices = {
  models: [{ id: "stub-model", providerID: "stub", name: "Stub", variants: [{ id: "high" }] }],
}

export const frame = (type: string, data: object) => ({
  id: `evt_${crypto.randomUUID()}`,
  created: Date.now(),
  type,
  data,
})

export const make = Effect.fnUntraced(function* (options: Options = {}) {
  const prompted = yield* Queue.unbounded<Prompt>()
  const interrupted = yield* Queue.unbounded<string>()
  const opened = yield* Queue.unbounded<number>()
  const checked = yield* Queue.unbounded<string>()
  const encoder = new TextEncoder()
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const state = {
    spaceId: Space.ID.create(),
    created: Array.of<typeof Created.Type>(),
    prompts: Array.of<Prompt>(),
    delivered: new Set<string>(),
    busy: new Set<string>(),
    titles: new Map<string, string>(),
    answer: (_prompt: Prompt): void => undefined,
  }
  const send = (event: ReturnType<typeof frame> | SessionEvent.Frame) => {
    for (const controller of streams) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
  }
  const info = (id: Session.ID, spaceId: Space.ID) =>
    Schema.encodeSync(Session.Info)({
      id,
      spaceId,
      createdBy: Auth.UserID.make("usr_test"),
      agentId: null,
      origin: "chat",
      harness: "opencode",
      title: state.titles.get(id) ?? null,
      status: "idle",
      capabilities: SessionCapabilities.of("opencode"),
      createdAt: DateTime.nowUnsafe(),
      updatedAt: DateTime.nowUnsafe(),
      archivedAt: null,
      filesResetAt: null,
    })
  const chat = async (path: string, request: Request) => {
    const parts = path.split("/")
    const sessionID = String(parts[3])
    if (path === "/chat/event") {
      const body = new ReadableStream<Uint8Array>({
        start: (controller) => {
          streams.add(controller)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame("server.connected", {}))}\n\n`))
          Queue.offerUnsafe(opened, streams.size)
        },
        cancel: () => {
          streams.clear()
        },
      })
      return new Response(body, { headers: { "content-type": "text/event-stream" } })
    }
    if (path === "/chat/status") {
      Queue.offerUnsafe(checked, path)
      return Response.json(Object.fromEntries([...state.busy].map((id) => [id, { type: "busy" }])))
    }
    if (parts[4] === "message") {
      const id = String(parts[5])
      return state.delivered.has(id)
        ? Response.json(
            Schema.encodeSync(SessionMessage.User)({
              id: SessionMessage.ID.make(id),
              time: { created: DateTime.nowUnsafe() },
              text: "delivered",
              type: "user",
            }),
          )
        : Response.json({ _tag: "NotFoundError", message: "No such message" }, { status: 404 })
    }
    if (parts[4] === "prompt") {
      const body = Schema.decodeUnknownSync(Prompted)(await request.json())
      const prompt = { sessionID, ...body }
      state.prompts.push(prompt)
      Queue.offerUnsafe(prompted, prompt)
      state.answer(prompt)
      return Response.json({ id: body.id })
    }
    if (parts[4] === "interrupt") {
      Queue.offerUnsafe(interrupted, sessionID)
      return new Response(null, { status: 204 })
    }
    return new Response("not found", { status: 404 })
  }
  const api = async (url: URL, request: Request) => {
    const parts = url.pathname.split("/")
    if (url.pathname === "/sessions") {
      const input = Schema.decodeUnknownSync(Created)(await request.json())
      state.created.push(input)
      await options.created?.(input.id)
      return Response.json(info(input.id, input.spaceId))
    }
    if (parts[3] === "chat")
      return Response.json({
        status: "ready",
        url: url.origin,
        token: "a-client-token",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      })
    if (parts[3] === "models") return Response.json(choices)
    return Response.json(info(Session.ID.make(String(parts[2])), state.spaceId))
  }
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        idleTimeout: 0,
        fetch: (request) => {
          const url = new URL(request.url)
          return url.pathname.startsWith("/chat/")
            ? (options.chat ?? chat)(`${url.pathname}${url.search}`, request)
            : api(url, request)
        },
      }),
    ),
    (served) => Effect.promise(() => served.stop(true)),
  )
  return {
    url: `http://127.0.0.1:${server.port}`,
    state,
    prompted,
    interrupted,
    opened,
    checked,
    send,
    drop: () => {
      for (const controller of streams) controller.close()
      streams.clear()
    },
  }
})
