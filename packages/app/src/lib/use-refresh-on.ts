import { useEffect, useEffectEvent, useRef } from "react"

export function useRefreshOn(version: number, refresh: () => void) {
  const seen = useRef(version)
  const run = useEffectEvent(refresh)
  useEffect(() => {
    if (seen.current === version) return
    seen.current = version
    run()
  }, [version])
}
