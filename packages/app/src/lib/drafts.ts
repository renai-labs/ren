export * as Drafts from "./drafts.js"

import { Composer } from "@ren/chat"
import { useRef, useState } from "react"
import { Platform } from "../platform/platform.js"

export const fresh = "new"

export const session = (sessionId: string) => `session.${sessionId}`

export function useDraft(key: string) {
  const platform = Platform.usePlatform()
  const drafts = platform.drafts ?? platform.storage
  const read = () => Composer.decode(drafts.get(key))
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
