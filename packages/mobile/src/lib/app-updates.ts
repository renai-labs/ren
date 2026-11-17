export * as AppUpdates from "./app-updates.js"

import { checkForUpdateAsync, fetchUpdateAsync, isEnabled, reloadAsync, useUpdates } from "expo-updates"
import { useEffect } from "react"
import { AppState } from "react-native"

const checkEvery = 15 * 60_000

const applyAfter = 5 * 60_000

const times = { checked: Date.now(), left: 0 }

export const fetchLatest = async () => {
  if (!isEnabled) return
  times.checked = Date.now()
  const check = await checkForUpdateAsync()
  if (check.isAvailable) await fetchUpdateAsync()
}

export const apply = () => reloadAsync()

export function useAutoApply() {
  const pending = useUpdates().isUpdatePending
  useEffect(() => {
    if (!isEnabled) return
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "background") times.left = Date.now()
      if (next !== "active") return
      if (pending && times.left > 0 && Date.now() - times.left >= applyAfter) return void reloadAsync()
      if (Date.now() - times.checked >= checkEvery) void fetchLatest().catch(() => undefined)
    })
    return () => subscription.remove()
  }, [pending])
}
