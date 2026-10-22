export * as Autosave from "./autosave.js"

import { useEffect, useEffectEvent, useRef, useState } from "react"

export function useText(value: string, onSave: (value: string) => Promise<unknown>) {
  const [draft, setDraft] = useState(value)
  const [received, setReceived] = useState(value)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [editing, setEditing] = useState(false)
  const revision = useRef(0)
  const queued = useRef<string | undefined>(undefined)
  const running = useRef(false)
  const saved = useRef(value)
  if (received !== value) {
    setReceived(value)
    if (!editing) setDraft(value)
  }
  const drain = useEffectEvent(async function flush() {
    if (running.current || queued.current === undefined) return
    const next = queued.current
    const started = revision.current
    queued.current = undefined
    if (next === saved.current) {
      setEditing(false)
      return
    }
    running.current = true
    setPending(true)
    setError(null)
    const success = await onSave(next).then(
      () => true,
      (cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Couldn’t save. Try again.")
        return false
      },
    )
    if (success) {
      saved.current = next
      if (started === revision.current) setEditing(false)
    }
    running.current = false
    setPending(false)
    await flush()
  })
  useEffect(() => {
    if (!editing) {
      saved.current = value
      return
    }
    queued.current = draft
    const timer = setTimeout(() => void drain(), 500)
    return () => clearTimeout(timer)
  }, [draft, value, attempt, editing])
  useEffect(
    () => () => {
      void drain()
    },
    [],
  )
  return {
    draft,
    change: (next: string) => {
      revision.current += 1
      queued.current = next
      setEditing(true)
      setDraft(next)
    },
    pending,
    error,
    retry: () => setAttempt((value) => value + 1),
  }
}
