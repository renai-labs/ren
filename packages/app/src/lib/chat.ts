export * as Chat from "./chat.js"

import { ChatAtoms } from "@ren/chat"
import { Ren } from "@ren/client/effect"
import type { Session } from "@ren/schema/session"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { Atom } from "effect/reactivity"
import type { Platform } from "../platform/platform.js"

export function make(platform: Platform.Info) {
  const made = new Map<string, ChatAtoms.ChatAtoms>()
  return (userId: string) => {
    const found = made.get(userId)
    if (found) return found
    const atoms = atomsFor(platform, userId)
    made.clear()
    made.set(userId, atoms)
    return atoms
  }
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
