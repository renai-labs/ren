export * as RenServer from "./ren.js"

import { Auth } from "@ren/schema/auth"
import { Session } from "@ren/schema/session"
import { SessionCapabilities } from "@ren/schema/session/capabilities"
import type { SessionCatalog } from "@ren/schema/session/catalog"
import type { SessionEvent } from "@ren/schema/session/event"
import { SessionInbox } from "@ren/schema/session/inbox"
import { SessionInfo } from "@ren/schema/session/info"
import { SessionMessage } from "@ren/schema/session/message"
import { SessionModel } from "@ren/schema/session/model"
import { Drive } from "@ren/schema/drive"
import { Factory } from "@ren/schema/factory"
import { Form } from "@ren/schema/form"
import { Permission } from "@ren/schema/permission"
import { Pagination } from "@ren/schema/pagination"
import { Space } from "@ren/schema/space"
import { SpaceMember } from "@ren/schema/space-member"
import { DateTime, Effect, Option, Queue, Schema, Struct } from "effect"

export interface Prompt {
  readonly sessionID: string
  readonly id: string
  readonly text: string
  readonly delivery: string
  readonly files?: ReadonlyArray<{ readonly path: string; readonly name: string }>
  readonly agents?: ReadonlyArray<{ readonly name: string; readonly mention?: typeof Mention.Type }>
  readonly skills?: ReadonlyArray<{ readonly id: string; readonly mention?: typeof Mention.Type }>
}

export interface Options {
  readonly chat?: (path: string, request: Request) => Promise<Response>
  readonly created?: (sessionId: Session.ID) => Promise<void>
  readonly imported?: (sessionId: Session.ID, transcript: unknown) => Promise<void>
  readonly saved?: (sessionId: string, url: URL) => Promise<Response>
}

const Created = Schema.Struct({ id: Session.ID, spaceId: Space.ID, model: Schema.optional(SessionModel.Ref) })
const Imported = Schema.Struct({
  spaceId: Space.ID,
  harness: Schema.String,
  model: Schema.optional(SessionModel.Ref),
  transcript: Schema.Json,
})
const Exported = Schema.Struct({ info: Schema.Struct({ title: Schema.String }) })
const Mention = Schema.Struct({ start: Schema.Number, end: Schema.Number, text: Schema.String })
const Prompted = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  delivery: Schema.String,
  files: Schema.optionalKey(Schema.Array(Schema.Struct({ path: Schema.String, name: Schema.String }))),
  agents: Schema.optionalKey(
    Schema.Array(Schema.Struct({ name: Schema.String, mention: Schema.optionalKey(Mention) })),
  ),
  skills: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Schema.String, mention: Schema.optionalKey(Mention) }))),
})
const Renamed = Schema.Struct({ title: Schema.String })
const Switched = Schema.Struct({ model: SessionModel.Ref })
const Compacted = Schema.Struct({ id: SessionMessage.ID })
const Uploading = Schema.Struct({
  spaceId: Schema.optionalKey(Schema.String),
  path: Schema.String,
  size: Schema.Number,
})
const PermissionReplied = Schema.Struct({
  reply: Permission.Reply,
  message: Schema.optionalKey(Schema.NullOr(Schema.String)),
})

export type Answer =
  | { readonly type: "permission"; readonly requestID: string; readonly reply: string; readonly message?: string }
  | { readonly type: "form"; readonly formID: string; readonly answer: Form.Answer }
  | { readonly type: "cancel"; readonly formID: string }

export interface Upload {
  readonly spaceId: string | undefined
  readonly path: string
  readonly bytes: Uint8Array
}

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
  const answered = yield* Queue.unbounded<Answer>()
  const uploaded = yield* Queue.unbounded<Upload>()
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
    permissions: Array.of<Permission.Request>(),
    forms: Array.of<Form.Info>(),
    children: Array.of<Session.ID>(),
    answers: Array.of<Answer>(),
    sessions: Array.of<Session.Info>(),
    saved: new Map<string, ReadonlyArray<SessionMessage.Info>>(),
    listed: Array.of<URLSearchParams>(),
    reads: Array.of<string>(),
    uploads: Array.of<Upload>(),
    maxUploadBytes: Drive.maxUploadBytes,
    agents: Array.of<SessionCatalog.Agent>(),
    skills: Array.of<SessionCatalog.Skill>(),
  }
  const send = (event: ReturnType<typeof frame> | SessionEvent.Frame) => {
    for (const controller of streams) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
  }
  const info = (id: Session.ID, spaceId: Space.ID, origin: Session.Origin = "chat") =>
    Schema.encodeSync(Session.Info)(
      state.sessions.find((each) => each.id === id) ?? {
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
      },
    )
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
  const missing = () => Response.json({ _tag: "NotFoundError", message: "No such request" }, { status: 404 })
  const record = (answer: Answer) => {
    state.answers.push(answer)
    Queue.offerUnsafe(answered, answer)
  }
  const routes: Record<string, ((sessionID: string, request: Request) => Promise<Response>) | undefined> = {
    session,
    children: (sessionID) =>
      Promise.resolve(
        Response.json(
          state.children.map((id) =>
            Schema.encodeSync(SessionInfo.Info)({
              id,
              parentID: Session.ID.make(sessionID),
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              time: { created: DateTime.nowUnsafe(), updated: DateTime.nowUnsafe() },
              capabilities: SessionCapabilities.of("opencode"),
            }),
          ),
        ),
      ),
    permission: async (sessionID, request) => {
      const requestID = new URL(request.url).pathname.split("/")[5]
      if (!requestID)
        return Response.json(
          Schema.encodeSync(Schema.Array(Permission.Request))(
            state.permissions.filter((each) => each.sessionID === sessionID),
          ),
        )
      const found = state.permissions.find((each) => each.id === requestID && each.sessionID === sessionID)
      if (!found) return missing()
      const body = Schema.decodeUnknownSync(PermissionReplied)(await request.json())
      record({ type: "permission", requestID, reply: body.reply, ...(body.message && { message: body.message }) })
      state.permissions = state.permissions.filter((each) => each !== found)
      send(frame("permission.replied", { sessionID, requestID, reply: body.reply }))
      return new Response(null, { status: 204 })
    },
    form: async (sessionID, request) => {
      const formID = new URL(request.url).pathname.split("/")[5]
      if (!formID)
        return Response.json(
          Schema.encodeSync(Schema.Array(Form.Info))(state.forms.filter((each) => each.sessionID === sessionID)),
        )
      const found = state.forms.find((each) => each.id === formID && each.sessionID === sessionID)
      if (!found) return missing()
      state.forms = state.forms.filter((each) => each !== found)
      if (request.method === "DELETE") {
        record({ type: "cancel", formID })
        send(frame("form.cancelled", { id: formID, sessionID }))
        return new Response(null, { status: 204 })
      }
      const answer = Schema.decodeUnknownSync(Form.Reply)(await request.json()).answer
      record({ type: "form", formID, answer })
      send(frame("form.replied", { id: formID, sessionID, answer }))
      return new Response(null, { status: 204 })
    },
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
    agent: () => Promise.resolve(Response.json(state.agents)),
    skill: () => Promise.resolve(Response.json(state.skills)),
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
      const raw = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(await request.json())
      const body = Schema.decodeUnknownSync(Prompted)(
        Object.fromEntries(Object.entries(raw).filter((entry) => entry[1] !== null)),
      )
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
  const list = (url: URL) => {
    state.listed.push(url.searchParams)
    const query = url.searchParams
    const search = query.get("search")?.toLowerCase()
    const found = state.sessions.filter(
      (each) =>
        query.getAll("spaceId").includes(each.spaceId) &&
        (!query.has("createdBy") || query.getAll("createdBy").includes(each.createdBy)) &&
        (!query.has("status") || query.get("status") === each.status) &&
        (!query.has("origin") || query.getAll("origin").includes(each.origin)) &&
        (!search || Boolean(each.title?.toLowerCase().includes(search))),
    )
    return Response.json(
      Schema.encodeSync(Pagination.Page(Session.Info))({
        items: found,
        page: Number(query.get("page") ?? 1),
        pageSize: Number(query.get("pageSize") ?? 50),
        total: found.length,
      }),
    )
  }
  const saved = (sessionId: string, url: URL) => {
    state.reads.push(sessionId)
    const newest = (state.saved.get(sessionId) ?? []).toReversed()
    const from = Number(url.searchParams.get("cursor") ?? 0)
    const to = from + Number(url.searchParams.get("limit") ?? 50)
    return Response.json(
      Schema.encodeSync(SessionMessage.Page)({
        items: newest.slice(from, to),
        cursor: to < newest.length ? { next: String(to) } : {},
      }),
    )
  }
  const reads: Record<string, ((url: URL) => Response | Promise<Response>) | undefined> = {
    "/sessions": list,
    messages: (url) => {
      const sessionId = String(url.pathname.split("/")[2])
      return options.saved ? options.saved(sessionId, url) : saved(sessionId, url)
    },
  }
  const api = (url: URL, request: Request) => {
    const read = request.method === "GET" ? reads[url.pathname.split("/")[3] ?? url.pathname] : undefined
    return read ? read(url) : rest(url, request)
  }
  const rest = async (url: URL, request: Request) => {
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
  const drive = async (url: URL, request: Request) => {
    if (url.pathname === "/drive/uploads") {
      const input = Schema.decodeUnknownSync(Uploading)(await request.json())
      if (input.size > state.maxUploadBytes)
        return Response.json(
          { _tag: "InvalidRequestError", message: `A file in the drive is at most ${state.maxUploadBytes} bytes.` },
          { status: 400 },
        )
      return Response.json({
        uploadId: crypto.randomUUID(),
        uploadUrl: `${url.origin}/upload`,
        fields: { key: input.path, ...(input.spaceId && { spaceId: input.spaceId }) },
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      })
    }
    // oxlint-disable-next-line typescript/no-deprecated -- The fake Ren reads the upload its own test client sent.
    const form = await request.formData()
    const file = form.get("file")
    if (!(file instanceof Blob)) return new Response("no file", { status: 400 })
    const spaceId = form.get("spaceId")
    const key = form.get("key")
    const upload = {
      spaceId: typeof spaceId === "string" ? spaceId : undefined,
      path: typeof key === "string" ? key : "",
      bytes: new Uint8Array(await file.arrayBuffer()),
    }
    state.uploads.push(upload)
    Queue.offerUnsafe(uploaded, upload)
    return new Response(null, { status: 204 })
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
  const paths: Record<string, ((url: URL, request: Request) => Response | Promise<Response>) | undefined> = {
    "/me": people,
    "/space-members": people,
    "/drive/uploads": drive,
    "/upload": drive,
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
          const path = paths[url.pathname]
          if (path) return path(url, request)
          const imported = url.pathname.match(/^\/sessions\/([^/]+)\/import$/u)?.[1]
          return imported ? importing(Session.ID.make(imported), request) : api(url, request)
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
    answered,
    uploaded,
    send,
    drop: () => {
      for (const controller of streams) controller.close()
      streams.clear()
    },
  }
})
