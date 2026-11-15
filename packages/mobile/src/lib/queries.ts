export * as Queries from "./queries.js"

import { ApiError } from "@ren/client"
import { Invalidation } from "@ren/client/react"
import { focusManager, hashKey, MutationCache, onlineManager, QueryCache, QueryClient } from "@tanstack/react-query"
import { addNetworkStateListener } from "expo-network"
import { AppState } from "react-native"
import { Auth } from "#lib/auth"

onlineManager.setEventListener((setOnline) => {
  const subscription = addNetworkStateListener((state) => setOnline(state.isConnected === true))
  return () => subscription.remove()
})

focusManager.setEventListener((setFocused) => {
  const subscription = AppState.addEventListener("change", (state) => setFocused(state === "active"))
  return () => subscription.remove()
})

const checkSession = async (error: unknown) => {
  if (ApiError.status(error) !== 401) return
  await client.refetchQueries({ queryKey: Auth.sessionOptions.queryKey, exact: true }, { cancelRefetch: false })
  if (client.getQueryData(Auth.sessionOptions.queryKey)) return
  client.removeQueries({ predicate: (query) => query.queryHash !== hashKey(Auth.sessionOptions.queryKey) })
}

export const client: QueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (query.queryHash !== hashKey(Auth.sessionOptions.queryKey)) void checkSession(error)
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => void checkSession(error),
    onSuccess: (_data, _variables, _context, mutation) => {
      const group = mutation.options.mutationKey?.at(0)
      if (typeof group !== "string") return
      const affected = Invalidation.affected(group)
      return client.invalidateQueries({
        predicate: (query) => affected.some((each) => each === query.queryKey.at(0)),
      })
    },
  }),
})
