import { useEffect, useEffectEvent } from "react"

export function useWhen(input: { readonly condition: boolean; readonly run: () => void }) {
  const act = useEffectEvent(input.run)
  useEffect(() => {
    if (input.condition) act()
  }, [input.condition])
}
