export * as Chat from "./chat.js"

import { scheduleTask, useAtomRefresh, useAtomValue } from "@effect/atom-react"
import { ChatAtoms, Outbox } from "@ren/chat"
import type { TimelineDetail } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Ren } from "@ren/client/effect"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import { Effect, Layer, Option, Schema, Stream, SubscriptionRef } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity"
import type { Platform } from "../platform/platform.js"
import { ChatPreferences } from "./chat-preferences.js"
import { FormProgress } from "./form-progress.js"

export interface Chat {
  readonly atoms: ChatAtoms.ChatAtoms
  readonly registry: AtomRegistry.AtomRegistry
  readonly detail: TimelineDetail.Detail | undefined
}

const made = new Map<string, Chat>()

export function forget() {
  for (const chat of made.values()) chat.registry.dispose()
  made.clear()
  FormProgress.reset()
}

export function forUser(platform: Platform.Info, userId: string) {
  const found = made.get(userId)
  if (found) return found
  forget()
  const detail = ChatPreferences.detailValue(ChatPreferences.detail.read(platform.storage))
  const chat = {
    atoms: atomsFor(platform, userId, detail),
    registry: AtomRegistry.make({ scheduleTask, defaultIdleTTL: 400 }),
    detail,
  }
  made.set(userId, chat)
  return chat
}

// oxlint-disable-next-line ren/no-comments -- Messages a chat's brain has not accepted yet, kept across reloads (E118).
const Kept = Schema.fromJsonString(Schema.Array(Outbox.Kept))

const untraced = Layer.succeed(HttpClient.TracerPropagationEnabled, false)

function atomsFor(platform: Platform.Info, userId: string, detail: TimelineDetail.Detail | undefined) {
  const server = Layer.mergeAll(
    FetchHttpClient.layer,
    untraced,
    platform.fetch ? Layer.succeed(FetchHttpClient.Fetch, platform.fetch) : Layer.empty,
  )
  return ChatAtoms.make({
    runtime: Atom.runtime(FetchHttpClient.layer),
    sender: { userId },
    ...(detail && { detail }),
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

const perAtoms = <K, A>(make: (atoms: ChatAtoms.ChatAtoms) => (key: K) => A) => {
  const made = new WeakMap<ChatAtoms.ChatAtoms, (key: K) => A>()
  return (atoms: ChatAtoms.ChatAtoms) => {
    const found = made.get(atoms)
    if (found) return found
    const family = make(atoms)
    made.set(atoms, family)
    return family
  }
}

const revealFamily = perAtoms((atoms) =>
  Atom.family((key: string) => {
    const parts = key.split(" ")
    const root = Session.ID.make(parts.at(0) ?? "")
    const sessionID = Session.ID.make(parts.at(1) ?? "")
    const messageID = parts.at(2)
    return Atom.make((get) =>
      messageID
        ? Effect.flatMap(get.result(atoms.session(root)), (opened) =>
            opened.reveal(sessionID, SessionMessage.ID.make(messageID)),
          )
        : Effect.succeed(false),
    )
  }),
)

const autoApproveFamily = perAtoms((atoms) =>
  Atom.family((sessionID: Session.ID) =>
    Atom.make((get) =>
      Stream.unwrap(
        Effect.map(get.result(atoms.session(sessionID)), (opened) => SubscriptionRef.changes(opened.autoApprove)),
      ),
    ),
  ),
)

export function useReveal(root: Session.ID, sessionID: Session.ID, messageID: string | undefined) {
  const result = useAtomValue(revealFamily(ChatReact.useAtoms())(`${root} ${sessionID} ${messageID ?? ""}`))
  return AsyncResult.isSuccess(result) ? result.value : undefined
}

export function useAutoApprove(sessionID: Session.ID) {
  const result = useAtomValue(autoApproveFamily(ChatReact.useAtoms())(sessionID))
  const set = ChatReact.useAction(sessionID, (opened, approval: { readonly enabled: boolean }) =>
    SubscriptionRef.set(opened.autoApprove, approval.enabled),
  )
  return { enabled: AsyncResult.isSuccess(result) && result.value, set }
}

export const useRetry = (sessionID: Session.ID) => useAtomRefresh(ChatReact.useAtoms().session(sessionID))
