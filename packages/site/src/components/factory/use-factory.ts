import { useCallback, useEffect, useMemo, useState } from "react"
import { ulid } from "../../lib/factory/rng.js"
import { simulate } from "../../lib/factory/simulate.js"
import { HOUR, MINUTE } from "../../lib/factory/time.js"
import { RESOLUTIONS, type Resolution, type VisitorAction } from "../../lib/factory/types.js"

const STORAGE_KEY = "ren-factory:actions:v1"
const STACK_KEY = "ren-factory:stacks:v1"
const REANCHOR = 30 * MINUTE

function readStored(key: string): unknown {
  try {
    // oxlint-disable-next-line no-restricted-properties -- the site has no Effect Schema; callers validate the value
    return JSON.parse(window.localStorage.getItem(key) ?? "null")
  } catch {
    return undefined
  }
}

function writeStored(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    return
  }
}

function isVisitorAction(value: unknown): value is VisitorAction {
  if (typeof value !== "object" || !value) return false
  const fields = new Map<string, unknown>(Object.entries(value))
  const optionalString = (key: string) => !fields.has(key) || typeof fields.get(key) === "string"
  const resolution = fields.get("resolution")
  return (
    typeof fields.get("id") === "string" &&
    typeof fields.get("at") === "number" &&
    typeof fields.get("taskId") === "string" &&
    RESOLUTIONS.some((known) => known === resolution) &&
    optionalString("note") &&
    optionalString("before")
  )
}

function loadActions(): VisitorAction[] {
  const stored = readStored(STORAGE_KEY)
  const cutoff = Date.now() - 12 * 24 * HOUR
  return Array.isArray(stored) ? stored.filter(isVisitorAction).filter((action) => action.at > cutoff) : []
}

function loadStacks(): Record<string, boolean> {
  const stored = readStored(STACK_KEY)
  if (typeof stored !== "object" || !stored) return {}
  return Object.fromEntries(
    Object.entries(stored).flatMap(([stage, expanded]) => (typeof expanded === "boolean" ? [[stage, expanded]] : [])),
  )
}

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

export function useFactoryWorld() {
  const [actions, setActions] = useState<VisitorAction[]>(loadActions)
  const [anchor, setAnchor] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setAnchor(Date.now()), REANCHOR)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setActions(loadActions())
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const world = useMemo(() => simulate(anchor, actions), [anchor, actions])

  const act = useCallback((taskId: string, resolution: Resolution, note?: string, before?: string) => {
    const at = Date.now()
    const action: VisitorAction = {
      id: `act_${ulid(at, taskId, resolution)}`,
      at,
      taskId,
      resolution,
      ...(note && { note }),
      ...(before && { before }),
    }
    setActions((previous) => {
      const next = [...previous, action]
      writeStored(STORAGE_KEY, next)
      return next
    })
  }, [])

  return { world, act }
}

export function useStackState() {
  const [stacks, setStacks] = useState<Record<string, boolean>>(loadStacks)
  const setStack = useCallback((stage: string, options: { expanded: boolean }) => {
    setStacks((previous) => {
      const next = { ...previous, [stage]: options.expanded }
      writeStored(STACK_KEY, next)
      return next
    })
  }, [])
  return [stacks, setStack] as const
}
