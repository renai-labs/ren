import { scheduleTask } from "@effect/atom-react"
import { ChatAtoms, type ChatSession, Outbox } from "@ren/chat"
import { Ren } from "@ren/client/effect"
import type { SessionInfo, SessionPage } from "@ren/client"
import type { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import { useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query"
import { Effect, Layer, Option, Predicate, Schema } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { Atom, AtomRegistry } from "effect/reactivity"
import { useEffect, useSyncExternalStore } from "react"
import type { Platform } from "../platform/platform.js"
import { RouterContext } from "./router-context.js"
import type { Runtime } from "./runtime.js"

export interface Chat {
  readonly generation: number
  readonly userId: string
  readonly atoms: ChatAtoms.ChatAtoms
  readonly registry: AtomRegistry.AtomRegistry
}

const Kept = Schema.fromJsonString(Schema.Array(Outbox.Kept))

const Cached = Schema.fromJsonString(Schema.Array(SessionMessage.Info))

const chatBytes = 5 * 1024 * 1024

const fitted = (messages: ReadonlyArray<SessionMessage.Info>): string | undefined => {
  const body = Schema.encodeSync(Cached)(messages)
  if (body.length <= chatBytes) return body
  return messages.length > 1 ? fitted(messages.slice(Math.ceil(messages.length / 4))) : undefined
}

function cacheFor(cache: Platform.ChatCache, userId: string) {
  return (sessionID: Session.ID) => ({
    read: Effect.promise(() => cache.read(userId, sessionID)).pipe(
      Effect.map((body) =>
        typeof body === "string" ? Option.getOrUndefined(Schema.decodeUnknownOption(Cached)(body)) : undefined,
      ),
    ),
    write: (messages: ReadonlyArray<SessionMessage.Info>) =>
      Effect.promise(() => {
        const body = fitted(messages)
        const sent = messages.some((message) => message.type === "user" && message.sender?.userId === userId)
        return body === undefined ? Promise.resolve() : cache.write(userId, sessionID, { body, tier: sent ? 2 : 3 })
      }),
  })
}

function makeAtoms(platform: Platform.Info, userId: string) {
  const server = Layer.mergeAll(
    FetchHttpClient.layer,
    Layer.succeed(HttpClient.TracerPropagationEnabled, false),
    platform.fetch ? Layer.succeed(FetchHttpClient.Fetch, platform.fetch) : Layer.empty,
  )
  return ChatAtoms.make({
    runtime: Atom.runtime(FetchHttpClient.layer),
    sender: { userId },
    ...(platform.onLifecycle && { lifecycle: platform.onLifecycle }),
    access: (sessionID: Session.ID, input: { readonly unreachable: boolean }) =>
      Ren.make({ baseUrl: platform.serverUrl }).pipe(
        Effect.flatMap((ren) =>
          ren.chat.access({ id: sessionID, ...(input.unreachable && { unreachable: "true" as const }) }),
        ),
        Effect.tapError((error) =>
          Predicate.isTagged(error, "NotFoundError") && platform.chatCache
            ? Effect.promise(() => platform.chatCache?.remove(userId, sessionID) ?? Promise.resolve())
            : Effect.void,
        ),
        Effect.provide(server),
      ),
    ...(platform.chatCache && { cache: cacheFor(platform.chatCache, userId) }),
    restart: (sessionID: Session.ID) =>
      Ren.make({ baseUrl: platform.serverUrl }).pipe(
        Effect.flatMap((ren) => ren.chat.retry({ id: sessionID })),
        Effect.asVoid,
        Effect.provide(server),
      ),
    outbox: (sessionID: Session.ID) => {
      const key = `session.${sessionID}.outbox`
      return {
        load: Effect.sync(() =>
          Schema.decodeUnknownOption(Kept)(platform.storage.get(key)).pipe(Option.getOrElse(() => [])),
        ),
        keep: (items: ReadonlyArray<Outbox.Kept>) =>
          Effect.sync(() =>
            items.length === 0
              ? platform.storage.remove(key)
              : platform.storage.set(key, Schema.encodeSync(Kept)(items)),
          ),
      }
    },
    saved: (sessionID: Session.ID, query: { readonly limit: number }) =>
      Ren.make({ baseUrl: platform.serverUrl }).pipe(
        Effect.flatMap((ren) => ren.chat.messages({ id: sessionID, limit: query.limit })),
        Effect.provide(server),
      ),
  })
}

const current: { chat: Chat | undefined; mounted: Chat | undefined; generation: number } = {
  chat: undefined,
  mounted: undefined,
  generation: 0,
}

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function retire(chat: Chat | undefined) {
  if (chat !== undefined && chat !== current.mounted) chat.registry.dispose()
}

function forget() {
  const chat = current.chat
  current.chat = undefined
  retire(chat)
  for (const listener of listeners) listener()
}

function chatFor(platform: Platform.Info, userId: string): Chat {
  if (current.chat?.userId === userId) return current.chat
  retire(current.chat)
  void platform.chatCache?.forget(userId)
  current.generation += 1
  const chat = {
    generation: current.generation,
    userId,
    atoms: makeAtoms(platform, userId),
    registry: AtomRegistry.make({ scheduleTask, defaultIdleTTL: 400 }),
  }
  current.chat = chat
  return chat
}

export function useCurrentChat(platform: Platform.Info, userId: string): Chat {
  const chat = useSyncExternalStore(subscribe, () => chatFor(platform, userId))
  useEffect(() => {
    current.mounted = chat
    return () => {
      current.mounted = undefined
      if (current.chat !== chat) chat.registry.dispose()
    }
  }, [chat])
  return chat
}

export function handoff(platform: Platform.Info, userId: string, sessionID: Session.ID, message: ChatSession.Handoff) {
  chatFor(platform, userId).atoms.handoff(sessionID, message)
}

export function resetSession(queryClient: QueryClient) {
  forget()
  queryClient.clear()
}

const patchSession = (
  queryClient: QueryClient,
  api: Runtime.Context["api"],
  sessionID: string,
  patch: Partial<SessionInfo>,
) => {
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

export function useChatCacheBridge(
  sessionID: string,
  live: { readonly title?: string | undefined; readonly status?: Session.Status | undefined },
) {
  const queryClient = useQueryClient()
  const { api } = RouterContext.useRouterContext()
  const title = live.title
  const status = live.status
  useEffect(() => {
    if (status === "idle")
      // ast-grep-ignore: no-manual-invalidation -- a chat's turn ends in the brain, not in a generated mutation
      void queryClient.invalidateQueries({ queryKey: api.link.session.usage.queryKey({ id: sessionID }) })
    if (title === undefined && status === undefined) return
    patchSession(queryClient, api, sessionID, {
      ...(title !== undefined && { title }),
      ...(status !== undefined && { status }),
    })
  }, [queryClient, api, sessionID, title, status])
}
