export * as Queries from "./queries.js"

import { focusManager, MutationCache, onlineManager, QueryClient } from "@tanstack/react-query"
import { addNetworkStateListener } from "expo-network"
import { AppState } from "react-native"

onlineManager.setEventListener((setOnline) => {
  const subscription = addNetworkStateListener((state) => setOnline(state.isConnected === true))
  return () => subscription.remove()
})

focusManager.setEventListener((setFocused) => {
  const subscription = AppState.addEventListener("change", (state) => setFocused(state === "active"))
  return () => subscription.remove()
})

export const client: QueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
  mutationCache: new MutationCache({
    onSuccess: (_data, _variables, _context, mutation) => {
      const group = mutation.options.mutationKey?.at(0)
      if (typeof group !== "string") return
      return client.invalidateQueries({ predicate: (query) => query.queryKey.at(0) === group })
    },
  }),
})
