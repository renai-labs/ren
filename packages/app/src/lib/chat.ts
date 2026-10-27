import { scheduleTask } from "@effect/atom-react"
import { ChatAtoms, type ChatSession, Outbox } from "@ren/chat"
import { Ren } from "@ren/client/effect"
import type { SessionInfo, SessionPage } from "@ren/client"
import type { Session } from "@ren/schema/session"
import type { InfiniteData } from "@tanstack/react-query"
import { Effect, Layer, Option, Schema } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { Atom, AtomRegistry } from "effect/reactivity"
import { useEffect } from "react"
import { api, credentialedFetch, queryClient, serverUrl } from "@/lib/api"

export interface Chat {
  readonly userId: string
  readonly atoms: ChatAtoms.ChatAtoms
  readonly registry: AtomRegistry.AtomRegistry
}

const Kept = Schema.fromJsonString(Schema.Array(Outbox.Kept))

const server = Layer.mergeAll(
  FetchHttpClient.layer,
  Layer.succeed(HttpClient.TracerPropagationEnabled, false),
  Layer.succeed(FetchHttpClient.Fetch, credentialedFetch),
)

const lifecycle = (listener: (event: ChatAtoms.Lifecycle) => void) => {
  const visible = () => {
    if (document.visibilityState === "visible") listener("foreground")
  }
  const online = () => listener("online")
  document.addEventListener("visibilitychange", visible)
  window.addEventListener("online", online)
  return () => {
    document.removeEventListener("visibilitychange", visible)
    window.removeEventListener("online", online)
  }
}

function makeAtoms(userId: string) {
  return ChatAtoms.make({
    runtime: Atom.runtime(FetchHttpClient.layer),
    sender: { userId },
    lifecycle,
    access: (sessionID: Session.ID, input: { readonly unreachable: boolean }) =>
      Ren.make({ baseUrl: serverUrl }).pipe(
        Effect.flatMap((ren) =>
          ren.chat.access({ id: sessionID, ...(input.unreachable && { unreachable: "true" as const }) }),
        ),
        Effect.provide(server),
      ),
    outbox: (sessionID: Session.ID) => {
      const key = `ren.session.${sessionID}.outbox`
      return {
        load: Effect.sync(() =>
          Schema.decodeUnknownOption(Kept)(localStorage.getItem(key)).pipe(Option.getOrElse(() => [])),
        ),
        keep: (items: ReadonlyArray<Outbox.Kept>) =>
          Effect.sync(() =>
            items.length === 0 ? localStorage.removeItem(key) : localStorage.setItem(key, Schema.encodeSync(Kept)(items)),
          ),
      }
    },
    saved: (sessionID: Session.ID, query: { readonly limit: number }) =>
      Ren.make({ baseUrl: serverUrl }).pipe(
        Effect.flatMap((ren) => ren.chat.messages({ id: sessionID, limit: query.limit })),
        Effect.provide(server),
      ),
  })
}

const current: { chat: Chat | undefined } = { chat: undefined }

function resetChat() {
  current.chat?.registry.dispose()
  current.chat = undefined
}

export function chatFor(userId: string): Chat {
  if (current.chat?.userId === userId) return current.chat
  resetChat()
  const chat = {
    userId,
    atoms: makeAtoms(userId),
    registry: AtomRegistry.make({ scheduleTask, defaultIdleTTL: 400 }),
  }
  current.chat = chat
  return chat
}

export function handoff(userId: string, sessionID: Session.ID, message: ChatSession.Handoff) {
  chatFor(userId).atoms.handoff(sessionID, message)
}

export function resetSession() {
  resetChat()
  queryClient.clear()
}

const patchSession = (sessionID: string, patch: Partial<SessionInfo>) => {
  const update = (item: SessionInfo) => (item.id === sessionID ? { ...item, ...patch } : item)
  queryClient.setQueriesData<SessionPage>({ queryKey: api.session.list.queryKey() }, (page) =>
    page ? { ...page, items: page.items.map(update) } : page,
  )
  queryClient.setQueriesData<InfiniteData<SessionPage>>({ queryKey: sessionKeys.infinite() }, (data) =>
    data ? { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.map(update) })) } : data,
  )
  queryClient.setQueriesData<SessionInfo>({ queryKey: api.session.get.queryKey() }, (info) =>
    info ? update(info) : info,
  )
}

export const sessionKeys = {
  infinite: () => ["session", "infinite"] as const,
  infinitePage: (input: { readonly pageSize: number }) => ["session", "infinite", input] as const,
}

export function useChatCacheBridge(sessionID: string, live: { readonly title?: string | undefined; readonly status?: Session.Status | undefined }) {
  const title = live.title
  const status = live.status
  useEffect(() => {
    if (title === undefined && status === undefined) return
    patchSession(sessionID, { ...(title !== undefined && { title }), ...(status !== undefined && { status }) })
  }, [sessionID, title, status])
}
