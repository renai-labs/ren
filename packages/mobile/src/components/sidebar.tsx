import { LegendList } from "@legendapp/list/react-native"
import { SessionPages } from "@ren/client/react"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { cn } from "cn"
import { type Href, useGlobalSearchParams, usePathname, useRouter } from "expo-router"
import type { ComponentProps } from "react"
import { Pressable, View } from "react-native"
import ChevronRightIcon from "react-native-heroicons/mini/ChevronRightIcon"
import ClipboardDocumentCheckIcon from "react-native-heroicons/mini/ClipboardDocumentCheckIcon"
import Cog6ToothIcon from "react-native-heroicons/mini/Cog6ToothIcon"
import FolderIcon from "react-native-heroicons/mini/FolderIcon"
import PencilSquareIcon from "react-native-heroicons/mini/PencilSquareIcon"
import { Avatar } from "#components/avatar"
import { Icon } from "#components/icon"
import { OrgSwitcher } from "#components/org-switcher"
import { Text } from "#components/text"
import { ChatRow } from "#features/chat/chat-row"
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

function AccountRow(props: { readonly active: boolean; readonly onPress: () => void }) {
  const user = useQuery(Auth.sessionOptions).data?.user
  const name = user?.name || user?.email || ""
  return (
    <Pressable
      role="link"
      aria-label="Settings"
      aria-current={props.active ? "page" : undefined}
      className={cn(
        "mx-2 min-h-12 flex-row items-center gap-3 rounded-lg p-2",
        props.active ? "bg-sidebar-accent" : "active:bg-sidebar-accent",
      )}
      onPress={props.onPress}
    >
      <Avatar name={name} />
      <View className="flex-1">
        <Text className="text-sm font-medium text-sidebar-foreground" numberOfLines={1}>
          {name}
        </Text>
        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
          {user?.email ?? ""}
        </Text>
      </View>
      <View className="size-10 items-center justify-center">
        <Icon as={Cog6ToothIcon} className="size-4.5 text-sidebar-foreground/55" />
      </View>
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
    router.navigate(href)
    props.onClose()
  }

  return (
    <View className="flex-1 bg-sidebar py-safe-offset-2">
      <View className="pb-3">
        <OrgSwitcher onSwitched={props.onClose} />
      </View>
      <NavRow icon={PencilSquareIcon} label="New chat" active={pathname === "/"} onPress={() => go("/")} />
      <NavRow icon={ClipboardDocumentCheckIcon} label="Tasks" active={within("/tasks")} onPress={() => go("/tasks")} />
      <NavRow icon={FolderIcon} label="Drive" active={within("/drive")} onPress={() => go("/drive")} />
      <Pressable
        role="link"
        aria-label="All chats"
        aria-current={pathname === "/chats" ? "page" : undefined}
        className="mt-4 flex-row items-center gap-1 self-start px-5 py-2 active:opacity-70"
        onPress={() => go("/chats")}
      >
        <Text className="text-sm font-medium text-sidebar-foreground/80">Chats</Text>
        <Icon as={ChevronRightIcon} className="size-4 text-sidebar-foreground/55" />
      </Pressable>
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
      <View className="border-t border-sidebar-border pt-2">
        <AccountRow active={pathname === "/settings"} onPress={() => go("/settings")} />
      </View>
    </View>
  )
}

export { Sidebar }
