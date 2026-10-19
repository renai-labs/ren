export * as Chat from "./chat.js"

import { scheduleTask } from "@effect/atom-react"
import { ChatAtoms } from "@ren/chat"
import { Ren } from "@ren/client/effect"
import type { Session } from "@ren/schema/session"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { Atom, AtomRegistry } from "effect/reactivity"
import type { Platform } from "../platform/platform.js"

interface Chat {
  readonly atoms: ChatAtoms.ChatAtoms
  readonly registry: AtomRegistry.AtomRegistry
}

const made = new Map<string, Chat>()

export function forUser(platform: Platform.Info, userId: string) {
  const found = made.get(userId)
  if (found) return found
  made.forEach((chat) => chat.registry.dispose())
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
