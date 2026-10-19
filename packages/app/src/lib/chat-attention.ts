export * as ChatAttention from "./chat-attention.js"

import { Family } from "@ren/chat"
import type { Session } from "@ren/schema/session"
import { SubscriptionRef } from "effect"
import { AsyncResult } from "effect/reactivity"
import type { Atom, AtomRegistry } from "effect/reactivity"
import { useSyncExternalStore } from "react"
import { Chat } from "./chat.js"

const listeners = new Set<() => void>()
const clock: { timer: ReturnType<typeof setInterval> | undefined } = { timer: undefined }

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  clock.timer ??= setInterval(() => {
    for (const each of listeners) each()
  }, 1000)
  return () => {
    listeners.delete(listener)
    if (listeners.size > 0) return
    clearInterval(clock.timer)
    clock.timer = undefined
  }
}

const peek = <A>(registry: AtomRegistry.AtomRegistry, atom: Atom.Atom<A>): A | undefined => {
  const node = registry.getNodes().get(atom)
  // oxlint-disable-next-line typescript/no-unsafe-return -- the registry keys each node by its atom, so the node holds that atom's value
  return node?.currentState() === "valid" ? node.value() : undefined
}

const read = (chat: Chat.Chat, sessionID: Session.ID): Family.Attention => {
  const opened = peek(chat.registry, chat.atoms.session(sessionID))
  if (!opened || !AsyncResult.isSuccess(opened)) return "idle"
  return Family.attention(SubscriptionRef.getUnsafe(opened.value.state), sessionID)
}

const idle = (): Family.Attention => "idle"

export function useAttention(chat: Chat.Chat, sessionID: Session.ID) {
  return useSyncExternalStore(subscribe, () => read(chat, sessionID), idle)
}
