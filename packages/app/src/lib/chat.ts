import { scheduleTask, useAtomValue } from "@effect/atom-react"
import { ChatAtoms, type ChatSession, Outbox } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Ren } from "@ren/client/effect"
import type { SessionInfo, SessionPage } from "@ren/client"
import type { Session } from "@ren/schema/session"
import { useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query"
import { Effect, Layer, Option, Schema, Stream, SubscriptionRef } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity"
import { useEffect } from "react"
import type { Platform } from "../platform/platform.js"
import { RouterContext } from "./router-context.js"
import type { Runtime } from "./runtime.js"

export interface Chat {
  readonly userId: string
  readonly atoms: ChatAtoms.ChatAtoms
  readonly registry: AtomRegistry.AtomRegistry
}

const Kept = Schema.fromJsonString(Schema.Array(Outbox.Kept))

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

const current: { chat: Chat | undefined } = { chat: undefined }

function forget() {
  current.chat?.registry.dispose()
  current.chat = undefined
}

export function chatFor(platform: Platform.Info, userId: string): Chat {
  if (current.chat?.userId === userId) return current.chat
  forget()
  const chat = {
    userId,
    atoms: makeAtoms(platform, userId),
    registry: AtomRegistry.make({ scheduleTask, defaultIdleTTL: 400 }),
  }
  current.chat = chat
  return chat
}

export function handoff(platform: Platform.Info, userId: string, sessionID: Session.ID, message: ChatSession.Handoff) {
  chatFor(platform, userId).atoms.handoff(sessionID, message)
}

export function resetSession(queryClient: QueryClient) {
  forget()
  queryClient.clear()
}

const autoApproveFamilies = new WeakMap<
  ChatAtoms.ChatAtoms,
  (sessionID: Session.ID) => Atom.Atom<AsyncResult.AsyncResult<boolean, unknown>>
>()

const autoApproveFamily = (atoms: ChatAtoms.ChatAtoms) => {
  const found = autoApproveFamilies.get(atoms)
  if (found) return found
  const family = Atom.family((sessionID: Session.ID) =>
    Atom.make((get) =>
      Stream.unwrap(
        Effect.map(get.result(atoms.session(sessionID)), (opened) => SubscriptionRef.changes(opened.autoApprove)),
      ),
    ),
  )
  autoApproveFamilies.set(atoms, family)
  return family
}

export function useAutoApprove(sessionID: Session.ID) {
  const result = useAtomValue(autoApproveFamily(ChatReact.useAtoms())(sessionID))
  const set = ChatReact.useAction(sessionID, (opened, approval: { readonly enabled: boolean }) =>
    SubscriptionRef.set(opened.autoApprove, approval.enabled),
  )
  return { enabled: AsyncResult.isSuccess(result) && result.value, set }
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
    if (title === undefined && status === undefined) return
    patchSession(queryClient, api, sessionID, {
      ...(title !== undefined && { title }),
      ...(status !== undefined && { status }),
    })
  }, [queryClient, api, sessionID, title, status])
}
