import { useEffect, useEffectEvent, useRef } from "react"
import { AsyncResult } from "effect/reactivity"

export function useRefreshOn(version: number, refresh: () => void) {
  const seen = useRef(version)
  const run = useEffectEvent(refresh)
  useEffect(() => {
    if (seen.current === version) return
    seen.current = version
    run()
  }, [version])
}

export function useRevalidate(read: {
  readonly result: AsyncResult.AsyncResult<unknown, unknown>
  readonly refresh: () => void
}) {
  const stale = useRef(AsyncResult.isSuccess(read.result))
  const run = useEffectEvent(read.refresh)
  useEffect(() => {
    if (stale.current) run()
  }, [])
}
