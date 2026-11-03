import { RegistryContext } from "@effect/atom-react"
import { ChatReact } from "@ren/chat/react"
import { useSuspenseQuery } from "@tanstack/react-query"
import { Storage } from "expo-sqlite/kv-store"
import { Drawer } from "expo-router/drawer"
import { Sidebar } from "#components/sidebar"
import { Auth } from "#lib/auth"
import { Lifecycle } from "#lib/lifecycle"

export default function AppLayout() {
  const chat = ChatReact.runtime({
    serverUrl: Auth.serverUrl,
    userId: useSuspenseQuery(Auth.sessionOptions).data?.user.id ?? "",
    storage: {
      get: (key) => Storage.getItemSync(key) ?? undefined,
      set: (key, value) => Storage.setItemSync(key, value),
      remove: (key) => void Storage.removeItemSync(key),
    },
    fetch: Auth.sessionFetch,
    chatFetch: Auth.sessionFetch,
    lifecycle: Lifecycle.listen,
  })
  return (
    <RegistryContext value={chat.registry}>
      <ChatReact.Provider atoms={chat.atoms}>
        <Drawer
          backBehavior="history"
          drawerContent={(drawer) => <Sidebar onClose={() => drawer.navigation.closeDrawer()} />}
          screenOptions={{ headerShadowVisible: false, drawerType: "front" }}
        >
          <Drawer.Screen name="index" options={{ title: "New chat" }} />
          <Drawer.Screen name="chats" options={{ title: "Chats" }} />
          <Drawer.Screen name="chat/[id]" options={{ title: "" }} />
        </Drawer>
      </ChatReact.Provider>
    </RegistryContext>
  )
}
