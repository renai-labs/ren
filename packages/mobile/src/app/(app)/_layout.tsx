import { RegistryContext } from "@effect/atom-react"
import { ChatReact } from "@ren/chat/react"
import { useSuspenseQuery } from "@tanstack/react-query"
import { Storage } from "expo-sqlite/kv-store"
import { Drawer } from "expo-router/drawer"
import { headerOptions, MenuButton } from "#components/header-button"
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
    flushInterval: "64 millis",
  })
  return (
    <RegistryContext value={chat.registry}>
      <ChatReact.Provider atoms={chat.atoms}>
        <Drawer
          backBehavior="history"
          drawerContent={(drawer) => <Sidebar onClose={() => drawer.navigation.closeDrawer()} />}
          screenOptions={{
            ...headerOptions,
            headerLeft: () => <MenuButton />,
            drawerType: "front",
            drawerStyle: { backgroundColor: "transparent" },
          }}
        >
          <Drawer.Screen name="index" options={{ title: "New chat" }} />
          <Drawer.Screen name="chats" options={{ title: "Chats" }} />
          <Drawer.Screen name="chat/[id]" options={{ title: "" }} />
          <Drawer.Screen name="tasks" options={{ title: "Tasks", headerShown: false }} />
          <Drawer.Screen name="drive" options={{ title: "Drive", headerShown: false }} />
          <Drawer.Screen name="settings" options={{ title: "Settings" }} />
        </Drawer>
      </ChatReact.Provider>
    </RegistryContext>
  )
}
