export * as Chat from "./chat.js"

import { scheduleTask, useAtomValue } from "@effect/atom-react"
import { ChatAtoms } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Ren } from "@ren/client/effect"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session-message"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity"
import type { Platform } from "../platform/platform.js"

export interface Chat {
  readonly atoms: ChatAtoms.ChatAtoms
  readonly registry: AtomRegistry.AtomRegistry
}

const made = new Map<string, Chat>()

export function forUser(platform: Platform.Info, userId: string) {
  const found = made.get(userId)
  if (found) return found
  for (const chat of made.values()) chat.registry.dispose()
  made.clear()
  const chat = { atoms: atomsFor(platform, userId), registry: AtomRegistry.make({ scheduleTask, defaultIdleTTL: 400 }) }
  made.set(userId, chat)
  return chat
}

const untraced = Layer.succeed(HttpClient.TracerPropagationEnabled, false)

function atomsFor(platform: Platform.Info, userId: string) {
  const server = Layer.mergeAll(
    FetchHttpClient.layer,
    untraced,
    platform.fetch ? Layer.succeed(FetchHttpClient.Fetch, platform.fetch) : Layer.empty,
  )
  return ChatAtoms.make({
    runtime: Atom.runtime(FetchHttpClient.layer),
    sender: { userId },
    ...(platform.onLifecycle && { lifecycle: platform.onLifecycle }),
    access: (sessionID: Session.ID) =>
      Ren.make({ baseUrl: platform.serverUrl }).pipe(
        Effect.flatMap((ren) => ren.chat.access({ id: sessionID })),
        Effect.provide(server),
      ),
  })
}

const reveals = new WeakMap<
  ChatAtoms.ChatAtoms,
  (key: string) => Atom.Atom<AsyncResult.AsyncResult<boolean, unknown>>
>()

const revealFamily = (atoms: ChatAtoms.ChatAtoms) => {
  const found = reveals.get(atoms)
  if (found) return found
  const family = Atom.family((key: string) => {
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
  })
  reveals.set(atoms, family)
  return family
}

export function useReveal(root: Session.ID, sessionID: Session.ID, messageID: string | undefined) {
  const result = useAtomValue(revealFamily(ChatReact.useAtoms())(`${root} ${sessionID} ${messageID ?? ""}`))
  return AsyncResult.isSuccess(result) ? result.value : undefined
}
