export * as RenServer from "./ren.js"

import { Auth } from "@ren/schema/auth"
import { Session } from "@ren/schema/session"
import { SessionCapabilities } from "@ren/schema/session/capabilities"
import type { SessionEvent } from "@ren/schema/session/event"
import { SessionInbox } from "@ren/schema/session/inbox"
import { SessionInfo } from "@ren/schema/session/info"
import { SessionMessage } from "@ren/schema/session/message"
import { SessionModel } from "@ren/schema/session/model"
import { Factory } from "@ren/schema/factory"
import { Pagination } from "@ren/schema/pagination"
import { Space } from "@ren/schema/space"
import { SpaceMember } from "@ren/schema/space-member"
import { DateTime, Effect, Option, Queue, Schema, Struct } from "effect"

export interface Prompt {
  readonly sessionID: string
  readonly id: string
  readonly text: string
  readonly delivery: string
}

export interface Options {
  readonly chat?: (path: string, request: Request) => Promise<Response>
  readonly created?: (sessionId: Session.ID) => Promise<void>
  readonly imported?: (sessionId: Session.ID, transcript: unknown) => Promise<void>
}

const Created = Schema.Struct({ id: Session.ID, spaceId: Space.ID, model: Schema.optional(SessionModel.Ref) })
const Imported = Schema.Struct({
  spaceId: Space.ID,
  harness: Schema.String,
  model: Schema.optional(SessionModel.Ref),
  transcript: Schema.Json,
})
const Exported = Schema.Struct({ info: Schema.Struct({ title: Schema.String }) })
const Prompted = Schema.Struct({ id: Schema.String, text: Schema.String, delivery: Schema.String })
const Renamed = Schema.Struct({ title: Schema.String })
const Switched = Schema.Struct({ model: SessionModel.Ref })
const Compacted = Schema.Struct({ id: SessionMessage.ID })

export interface Switch {
  readonly sessionID: string
  readonly model: SessionModel.Ref
}

const choices: SessionModel.Choices = {
  models: [{ id: "stub-model", providerID: "stub", name: "Stub", variants: [{ id: "high" }] }],
}

export const otherChoices: SessionModel.Choices = {
  models: [
    { id: "first-model", providerID: "stub", name: "First", variants: [] },
    { id: "other-model", providerID: "stub", name: "Other", variants: [{ id: "low" }] },
  ],
  default: { providerID: "stub", id: "other-model" },
}

interface Person {
  readonly id: Auth.UserID
  readonly name: string
}

interface Joined {
  readonly id: Space.ID
  readonly slug: string
  readonly name: string
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
  const prepared = yield* Queue.unbounded<Space.ID>()
  const closed = yield* Queue.unbounded<string>()
  const renamed = yield* Queue.unbounded<string>()
  const refused = yield* Queue.unbounded<string>()
  const archived = yield* Queue.unbounded<string>()
  const compacted = yield* Queue.unbounded<SessionMessage.ID>()
  const encoder = new TextEncoder()
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const alpha: Joined = { id: Space.ID.create(), slug: "alpha", name: "Alpha" }
  const beta: Joined = { id: Space.ID.create(), slug: "beta", name: "Beta" }
  const me: Person = { id: Auth.UserID.create(), name: "Ada" }
  const bea: Person = { id: Auth.UserID.create(), name: "Bea" }
  const state = {
    spaceId: alpha.id,
    alpha,
    beta,
    spaces: [alpha, beta],
    me,
    bea,
    members: [me, bea],
    messages: new Map<string, SessionMessage.User>(),
    models: new Map<string, SessionModel.Choices>(),
    created: Array.of<typeof Created.Type>(),
    imported: Array.of<typeof Imported.Type & { readonly id: Session.ID }>(),
    refuseImport: (): Response | undefined => undefined,
    prompts: Array.of<Prompt>(),
    delivered: new Set<string>(),
    busy: new Set<string>(),
    titles: new Map<string, string>(),
    renames: Array.of<{ readonly sessionID: string; readonly title: string }>(),
    refusing: false,
    answer: (_prompt: Prompt): void => undefined,
    remoteModels: new Map<string, SessionModel.Ref>(),
    compactable: true,
    switches: Array.of<Switch>(),
    local: Array.of<string>(),
    compactions: new Map<string, SessionMessage.CompactionCompleted>(),
    compact: (sessionID: string, id: SessionMessage.ID): void => {
      send(frame("session.compaction.started", { sessionID, reason: "manual", recent: "", inputID: id }))
      send(frame("session.compaction.ended", { sessionID, reason: "manual", text: "the summary", recent: "" }))
    },
    oauth: { deny: false, revoked: Array.of<string>() },
  }
  const send = (event: ReturnType<typeof frame> | SessionEvent.Frame) => {
    for (const controller of streams) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
  }
  const info = (id: Session.ID, spaceId: Space.ID, origin: Session.Origin = "chat") =>
    Schema.encodeSync(Session.Info)({
      id,
      spaceId,
      createdBy: Auth.UserID.make("usr_test"),
      agentId: null,
      origin,
      harness: "opencode",
      title: state.titles.get(id) ?? null,
      status: "idle",
      capabilities: SessionCapabilities.of("opencode"),
      createdAt: DateTime.nowUnsafe(),
      updatedAt: DateTime.nowUnsafe(),
      archivedAt: null,
      filesResetAt: null,
    })
  const space = (each: Joined) =>
    Schema.encodeSync(Space.Info)({
      ...each,
      organizationId: Auth.OrganizationID.make("org_test"),
      kind: "shared",
      ownerUserId: null,
      description: null,
      brainScope: "space",
      brain: { provider: null, environmentTemplateId: null },
      hand: Space.defaultHand,
      compute: { isPending: false, shutdown: null, lastShutdown: null },
      memberCount: 1,
      membershipId: Space.MembershipID.make("spm_test"),
      factory: Factory.empty,
      canUpdate: true,
      canJoin: false,
      canRequestJoin: false,
      joinRequestId: null,
      canAddMember: true,
      canRemoveMember: true,
      canArchive: true,
      createdAt: DateTime.nowUnsafe(),
      updatedAt: DateTime.nowUnsafe(),
      archivedAt: null,
    })
  const subscribe = (request: Request) => {
    const owner = atob((request.headers.get("authorization") ?? "").replace("Basic ", "")).replace("ren:token-", "")
    const opening: { controller?: ReadableStreamDefaultController<Uint8Array> } = {}
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        opening.controller = controller
        streams.add(controller)
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame("server.connected", {}))}\n\n`))
        Queue.offerUnsafe(opened, streams.size)
      },
      cancel: () => {
        if (opening.controller) streams.delete(opening.controller)
        Queue.offerUnsafe(closed, owner)
      },
    })
    return new Response(body, { headers: { "content-type": "text/event-stream" } })
  }
  const session = async (sessionID: string, request: Request) => {
    if (request.method === "PATCH") {
      const title = Schema.decodeUnknownSync(Renamed)(await request.json()).title
      state.renames.push({ sessionID, title })
      state.titles.set(sessionID, title)
      Queue.offerUnsafe(renamed, title)
      send(frame("session.renamed", { sessionID, title }))
      return new Response(null, { status: 204 })
    }
    const title = state.titles.get(sessionID)
    const model =
      state.remoteModels.get(sessionID) ??
      [...state.created, ...state.imported].find((each) => each.id === sessionID)?.model
    return Response.json(
      Schema.encodeSync(SessionInfo.Info)({
        id: Session.ID.make(sessionID),
        ...(title && { title }),
        ...(model && { model: { providerID: model.providerID, id: model.id, variant: model.variant ?? "default" } }),
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: DateTime.nowUnsafe(), updated: DateTime.nowUnsafe() },
        capabilities: Struct.assign(SessionCapabilities.of("opencode"), { compact: state.compactable }),
      }),
    )
  }
  const routes: Record<string, ((sessionID: string, request: Request) => Promise<Response>) | undefined> = {
    session,
    model: async (sessionID, request) => {
      const model = Schema.decodeUnknownSync(Switched)(await request.json()).model
      const spaceId = state.created.find((each) => each.id === sessionID)?.spaceId ?? state.spaceId
      if (
        !(state.models.get(spaceId) ?? choices).models.some(
          (choice) => SessionModel.key(choice) === SessionModel.key(model),
        )
      )
        return Response.json(
          { _tag: "InvalidRequestError", message: `This space has no model ${SessionModel.key(model)}` },
          { status: 400 },
        )
      state.switches.push({ sessionID, model })
      state.remoteModels.set(sessionID, model)
      return new Response(null, { status: 204 })
    },
    compact: async (sessionID, request) => {
      const id = Schema.decodeUnknownSync(Compacted)(await request.json()).id
      Queue.offerUnsafe(compacted, id)
      state.compact(sessionID, id)
      return Response.json(
        Schema.encodeSync(SessionInbox.Compaction)({
          id,
          sessionID: Session.ID.make(sessionID),
          time: { created: DateTime.nowUnsafe() },
          type: "compaction",
          payload: {},
          delivery: "steer",
        }),
      )
    },
  }
  const chat = async (path: string, request: Request) => {
    const parts = path.split("/")
    const sessionID = String(parts[3])
    if (path === "/chat/event") return subscribe(request)
    if (state.refusing) {
      Queue.offerUnsafe(refused, path)
      return new Response(null, { status: 502 })
    }
    if (path === "/chat/status") {
      Queue.offerUnsafe(checked, path)
      return Response.json(Object.fromEntries([...state.busy].map((id) => [id, { type: "busy" }])))
    }
    const route = routes[parts.length === 4 ? "session" : String(parts[4])]
    if (route) return route(sessionID, request)
    if (parts[4] === "message") {
      const id = String(parts[5])
      const compaction = state.compactions.get(id)
      if (compaction) return Response.json(Schema.encodeSync(SessionMessage.CompactionCompleted)(compaction))
      const stored = state.messages.get(id)
      if (stored) return Response.json(Schema.encodeSync(SessionMessage.User)(stored))
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
  const people = (url: URL) => {
    if (url.pathname === "/me")
      return Response.json(
        Schema.encodeSync(Auth.Me)({
          user: { id: state.me.id, name: state.me.name, email: "ada@example.com", emailVerified: true },
          organization: null,
        }),
      )
    return Response.json(
      Schema.encodeSync(Pagination.Page(SpaceMember.Info))({
        items: state.members.map((person) => ({
          id: Space.MembershipID.create(),
          spaceId: Space.ID.make(url.searchParams.get("spaceId") ?? ""),
          status: "active",
          userId: person.id,
          name: person.name,
          email: `${person.name.toLowerCase()}@example.com`,
          image: null,
          createdAt: DateTime.nowUnsafe(),
          archivedAt: null,
        })),
        page: 1,
        pageSize: 100,
        total: state.members.length,
      }),
    )
  }
  const importing = async (id: Session.ID, request: Request) => {
    const refused = state.refuseImport()
    if (refused) return refused
    const input = Schema.decodeUnknownSync(Imported)(await request.json())
    state.imported.push({ id, ...input })
    const title = Schema.decodeUnknownOption(Exported)(input.transcript).pipe(
      Option.map((exported) => exported.info.title),
    )
    if (Option.isSome(title)) state.titles.set(id, title.value)
    await options.imported?.(id, input.transcript)
    return Response.json(info(id, input.spaceId, "opencode"))
  }
  const api = async (url: URL, request: Request) => {
    const parts = url.pathname.split("/")
    if (url.pathname === "/sessions") {
      const input = Schema.decodeUnknownSync(Created)(await request.json())
      state.created.push(input)
      await options.created?.(input.id)
      return Response.json(info(input.id, input.spaceId))
    }
    if (url.pathname === "/spaces")
      return Response.json({
        items: state.spaces.map(space),
        page: 1,
        pageSize: state.spaces.length,
        total: state.spaces.length,
      })
    if (parts[1] === "spaces" && parts[3] === "chat") {
      Queue.offerUnsafe(prepared, Space.ID.make(String(parts[2])))
      return new Response(null, { status: 204 })
    }
    if (parts[1] === "spaces") {
      const found = state.spaces.find((each) => each.id === parts[2] || each.slug === parts[2])
      return found
        ? Response.json(space(found))
        : Response.json({ _tag: "NotFoundError", message: "No such space" }, { status: 404 })
    }
    if (parts[3] === "chat")
      return Response.json({
        status: "ready",
        url: url.origin,
        token: `token-${parts[2]}`,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      })
    if (parts[3] === "models") return Response.json(state.models.get(url.searchParams.get("spaceId") ?? "") ?? choices)
    return Response.json(info(Session.ID.make(String(parts[2])), state.spaceId))
  }
  const oauth = async (url: URL, request: Request) => {
    if (url.pathname === "/.well-known/oauth-protected-resource")
      return Response.json({ resource: url.origin, authorization_servers: [`${url.origin}/auth`] })
    if (url.pathname === "/.well-known/oauth-authorization-server/auth")
      return Response.json({
        authorization_endpoint: `${url.origin}/auth/oauth2/authorize`,
        token_endpoint: `${url.origin}/auth/oauth2/token`,
        revocation_endpoint: `${url.origin}/auth/oauth2/revoke`,
      })
    if (url.pathname === "/auth/oauth2/authorize") {
      const redirect = new URL(url.searchParams.get("redirect_uri") ?? "")
      redirect.search = new URLSearchParams({
        ...(state.oauth.deny
          ? { error: "access_denied", error_description: "You denied access to Ren." }
          : { code: "the-code" }),
        state: url.searchParams.get("state") ?? "",
      }).toString()
      return Response.redirect(redirect.href, 302)
    }
    if (url.pathname === "/auth/oauth2/revoke") {
      state.oauth.revoked.push(new URLSearchParams(await request.text()).get("token") ?? "")
      return new Response(null, { status: 200 })
    }
    return Response.json({ access_token: "signed-in", refresh_token: "refresh-signed-in", expires_in: 3600 })
  }
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        idleTimeout: 0,
        fetch: (request) => {
          const url = new URL(request.url)
          if (url.pathname.startsWith("/local/")) {
            state.local.push(url.pathname)
            return Response.json({ error: { message: "The local model was called" } }, { status: 500 })
          }
          if (request.method === "DELETE" && url.pathname.startsWith("/sessions/")) {
            Queue.offerUnsafe(archived, String(url.pathname.split("/")[2]))
            return api(url, request)
          }
          if (url.pathname.startsWith("/chat/")) return (options.chat ?? chat)(`${url.pathname}${url.search}`, request)
          if (url.pathname.startsWith("/.well-known/") || url.pathname.startsWith("/auth/")) return oauth(url, request)
          const imported = url.pathname.match(/^\/sessions\/([^/]+)\/import$/u)?.[1]
          if (imported) return importing(Session.ID.make(imported), request)
          return url.pathname === "/me" || url.pathname === "/space-members" ? people(url) : api(url, request)
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
    prepared,
    closed,
    renamed,
    refused,
    archived,
    compacted,
    send,
    drop: () => {
      for (const controller of streams) controller.close()
      streams.clear()
    },
  }
})
