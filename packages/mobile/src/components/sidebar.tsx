import { LegendList } from "@legendapp/list/react-native"
import { SessionPages } from "@ren/client/react"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { cn } from "cn"
import { type Href, useGlobalSearchParams, usePathname, useRouter } from "expo-router"
import type { ComponentProps } from "react"
import { Pressable, View } from "react-native"
import ChevronRightIcon from "react-native-heroicons/mini/ChevronRightIcon"
import ClipboardDocumentCheckIcon from "react-native-heroicons/mini/ClipboardDocumentCheckIcon"
import FolderIcon from "react-native-heroicons/mini/FolderIcon"
import MagnifyingGlassIcon from "react-native-heroicons/mini/MagnifyingGlassIcon"
import { Avatar } from "#components/avatar"
import { Icon } from "#components/icon"
import { Logomark } from "#components/logomark"
import { Text } from "#components/text"
import { ChatRow } from "#features/chat/chat-row"
import { NewChatButton } from "#features/chat/new-chat-button"
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
      className={cn(
        "mx-2 flex-row items-center gap-3 rounded-lg px-3 py-2.5",
        props.active ? "bg-sidebar-accent" : "active:bg-sidebar-accent",
      )}
      onPress={props.onPress}
    >
      <Icon as={props.icon} className="size-4.5 text-sidebar-foreground/55" />
      <Text className="text-sidebar-foreground">{props.label}</Text>
    </Pressable>
  )
}

function ProfileButton(props: { readonly onPress: () => void }) {
  const user = useQuery(Auth.sessionOptions).data?.user
  return (
    <Pressable
      role="link"
      aria-label="Settings"
      hitSlop={4}
      className="rounded-full shadow-soft active:opacity-80 dark:shadow-none"
      onPress={props.onPress}
    >
      <Avatar size="lg" name={user?.name || user?.email || ""} />
    </Pressable>
  )
}

function Sidebar(props: { readonly onClose: () => void }) {
  const router = useRouter()

  const pathname = usePathname()
  const openID = useGlobalSearchParams<{ id?: string }>().id
  const pages = useInfiniteQuery(SessionPages.options(Api.client))
  const chats = pages.data?.pages.flatMap((page) => page.items) ?? []
  const within = (path: string) => pathname === path || pathname.startsWith(`${path}/`)

  const go = (href: Href) => {
    props.onClose()
    router.navigate(href)
  }

  return (
    <View className="flex-1 rounded-r-2xl bg-sidebar py-safe-offset-2">
      <View className="mx-5 flex-row items-center gap-2 pt-3 pb-4">
        <Logomark className="size-6 text-sidebar-foreground" />
        <Text className="text-2xl font-semibold text-sidebar-foreground">Ren</Text>
      </View>
      <NavRow icon={ClipboardDocumentCheckIcon} label="Tasks" active={within("/tasks")} onPress={() => go("/tasks")} />
      <NavRow icon={FolderIcon} label="Drive" active={within("/drive")} onPress={() => go("/drive")} />
      <View className="mt-4 flex-row items-center justify-between pr-3">
        <Pressable
          role="link"
          aria-label="All chats"
          aria-current={pathname === "/chats" ? "page" : undefined}
          className="flex-row items-center gap-1 px-5 py-2 active:opacity-70"
          onPress={() => go("/chats")}
        >
          <Text className="text-sm font-medium text-sidebar-foreground/80">Chats</Text>
          <Icon as={ChevronRightIcon} className="size-4 text-sidebar-foreground/55" />
        </Pressable>
        <Pressable
          role="link"
          aria-label="Search chats"
          hitSlop={4}
          className="size-9 items-center justify-center rounded-full bg-card shadow-soft active:bg-sidebar-accent dark:bg-sidebar-accent dark:shadow-none"
          onPress={() => go("/chats")}
        >
          <Icon as={MagnifyingGlassIcon} className="size-4.5 text-sidebar-foreground" />
        </Pressable>
      </View>
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
        contentContainerClassName="pb-24"
        recycleItems
        onEndReached={() => {
          if (pages.hasNextPage && !pages.isFetchingNextPage) void pages.fetchNextPage()
        }}
      />
      <View
        className="absolute inset-x-0 bottom-0 flex-row items-center justify-between px-4 pb-safe-offset-4"
        pointerEvents="box-none"
      >
        <ProfileButton onPress={() => go("/settings")} />
        <NewChatButton onPress={props.onClose} />
      </View>
    </View>
  )
}

export { Sidebar }
