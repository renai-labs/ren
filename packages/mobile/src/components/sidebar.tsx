import { LegendList } from "@legendapp/list/react-native"
import { ChatReact } from "@ren/chat/react"
import { SessionPages } from "@ren/client/react"
import IconEdit from "@tabler/icons-react-native/IconEdit"
import IconLogout from "@tabler/icons-react-native/IconLogout"
import IconMessages from "@tabler/icons-react-native/IconMessages"
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import { type Href, useGlobalSearchParams, usePathname, useRouter } from "expo-router"
import type { ComponentProps } from "react"
import { Pressable, View } from "react-native"
import { Button } from "#components/button"
import { ChatRow } from "#components/chat-row"
import { Icon } from "#components/icon"
import { Text } from "#components/text"
import { Api } from "#lib/api"
import { Auth } from "#lib/auth"

function NavRow(props: {
  readonly icon: ComponentProps<typeof Icon>["as"]
  readonly label: string
  readonly active: boolean
  readonly onPress: () => void
}) {
  return (
    <Pressable
      role="link"
      aria-current={props.active ? "page" : undefined}
      className={
        props.active
          ? "mx-2 flex-row items-center gap-3 rounded-lg bg-accent px-3 py-2.5"
          : "mx-2 flex-row items-center gap-3 rounded-lg px-3 py-2.5 active:bg-accent"
      }
      onPress={props.onPress}
    >
      <Icon as={props.icon} className="size-4.5" />
      <Text className="font-medium">{props.label}</Text>
    </Pressable>
  )
}

function Sidebar(props: { readonly onClose: () => void }) {
  const router = useRouter()
  const pathname = usePathname()
  const openID = useGlobalSearchParams<{ id?: string }>().id
  const queryClient = useQueryClient()
  const user = useQuery(Auth.sessionOptions).data?.user
  const pages = useInfiniteQuery(SessionPages.options(Api.client))
  const chats = pages.data?.pages.flatMap((page) => page.items) ?? []

  const go = (href: Href) => {
    router.navigate(href)
    props.onClose()
  }
  const signOut = async () => {
    await Auth.client.signOut()
    ChatReact.forget()
    await queryClient.resetQueries()
  }

  return (
    <View className="flex-1 bg-sidebar py-safe">
      <Text className="px-5 pt-3 pb-4 text-lg font-semibold">Ren</Text>
      <NavRow icon={IconEdit} label="New chat" active={pathname === "/"} onPress={() => go("/")} />
      <NavRow icon={IconMessages} label="Chats" active={pathname === "/chats"} onPress={() => go("/chats")} />
      <Text className="px-5 pt-6 pb-2 text-sm text-muted-foreground">Recent</Text>
      <LegendList
        data={chats}
        keyExtractor={(chat) => chat.id}
        renderItem={(row) => (
          <ChatRow
            chat={row.item}
            active={pathname.startsWith("/chat/") && openID === row.item.id}
            onPress={() => go({ pathname: "/chat/[id]", params: { id: row.item.id } })}
          />
        )}
        estimatedItemSize={44}
        recycleItems
        onEndReached={() => {
          if (pages.hasNextPage && !pages.isFetchingNextPage) void pages.fetchNextPage()
        }}
      />
      <View className="flex-row items-center gap-3 border-t border-sidebar-border px-4 pt-3">
        <View className="size-8 items-center justify-center rounded-full bg-secondary">
          <Text className="text-sm font-medium">{user?.name.charAt(0).toUpperCase() ?? ""}</Text>
        </View>
        <View className="flex-1">
          <Text className="font-medium" numberOfLines={1}>
            {user?.name ?? ""}
          </Text>
          <Text className="text-sm text-muted-foreground" numberOfLines={1}>
            {user?.email ?? ""}
          </Text>
        </View>
        <Button variant="ghost" size="icon" aria-label="Sign out" onPress={() => void signOut()}>
          <Icon as={IconLogout} className="text-muted-foreground" />
        </Button>
      </View>
    </View>
  )
}

export { Sidebar }
