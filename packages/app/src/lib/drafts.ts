export * as Drafts from "./drafts.js"

import { Composer } from "@ren/chat"
import { useRef, useState } from "react"
import { Platform } from "../platform/platform.js"

export const fresh = "new"

export const session = (sessionId: string) => `session.${sessionId}`

export const space = (spaceId: string) => `new.space.${spaceId}`

export function useWrite() {
  const platform = Platform.usePlatform()
  const drafts = platform.drafts ?? platform.storage
  return (key: string, draft: Composer.Draft) => {
    const encoded = Composer.encode(draft)
    if (encoded === undefined) drafts.remove(key)
    else drafts.set(key, encoded)
  }
}

export function useDraft(key: string, initial?: Composer.Draft) {
  const platform = Platform.usePlatform()
  const drafts = platform.drafts ?? platform.storage
  const read = () => {
    const stored = drafts.get(key)
    return stored === undefined && initial ? initial : Composer.decode(stored)
  }
  const [kept, setKept] = useState(() => ({ key, draft: read() }))
  const latest = useRef(kept)
  const draft = kept.key === key ? kept.draft : read()
  const set = (next: Composer.Draft) => {
    latest.current = { key, draft: next }
    setKept(latest.current)
    const encoded = Composer.encode(next)
    if (encoded === undefined) drafts.remove(key)
    else drafts.set(key, encoded)
  }
  const update = (change: (current: Composer.Draft) => Composer.Draft) =>
    set(change(latest.current.key === key ? latest.current.draft : read()))
  return { draft, set, update }
}
