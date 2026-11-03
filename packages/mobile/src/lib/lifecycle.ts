export * as Lifecycle from "./lifecycle.js"

import type { ChatAtoms } from "@ren/chat"
import { addNetworkStateListener } from "expo-network"
import { AppState } from "react-native"

export const listen = (listener: (event: ChatAtoms.Lifecycle) => void) => {
  const app = AppState.addEventListener("change", (state) => {
    if (state === "active") listener("foreground")
  })
  const network = { connected: true }
  const subscription = addNetworkStateListener((state) => {
    const connected = state.isConnected === true
    if (connected && !network.connected) listener("online")
    network.connected = connected
  })
  return () => {
    app.remove()
    subscription.remove()
  }
}
