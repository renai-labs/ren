import { LegendList } from "@legendapp/list/react-native"
import { SessionPages } from "@ren/client/react"
import IconSearch from "@tabler/icons-react-native/IconSearch"
import IconX from "@tabler/icons-react-native/IconX"
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query"
import { useRouter } from "expo-router"
import { useDeferredValue, useState } from "react"
import { ActivityIndicator, Pressable, TextInput, View } from "react-native"
import { Button } from "#components/button"
import { ChatRow } from "#components/chat-row"
import { Icon } from "#components/icon"
import { NewChatButton } from "#components/new-chat-button"
import { Text } from "#components/text"
import { Api } from "#lib/api"

function Empty(props: { readonly search: string; readonly onClear: () => void; readonly onNew: () => void }) {
  if (props.search)
    return (
      <View className="items-center gap-3 p-6">
        <Text className="text-center text-muted-foreground">No chats match “{props.search}”.</Text>
        <Button variant="outline" onPress={props.onClear}>
          <Text>Clear search</Text>
        </Button>
      </View>
    )
  return (
    <View className="items-center gap-3 p-6">
      <Text className="text-center text-muted-foreground">Your chats with Ren show up here.</Text>
      <Button onPress={props.onNew}>
        <Text>New chat</Text>
      </Button>
    </View>
  )
}

export default function Chats() {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const needle = useDeferredValue(search.trim())
  const pages = useInfiniteQuery({
    ...SessionPages.options(Api.client, needle ? { search: needle } : {}),
    placeholderData: keepPreviousData,
  })
  const [pulling, setPulling] = useState(false)
  const chats = pages.data?.pages.flatMap((page) => page.items) ?? []

  const refresh = async () => {
    setPulling(true)
    await pages.refetch()
    setPulling(false)
  }

  return (
    <View className="flex-1 bg-background">
      <View className="px-4 pb-3">
        <View className="h-10 flex-row items-center gap-2 rounded-xl bg-muted px-3">
          <Icon as={IconSearch} className="size-4.5 text-muted-foreground" />
          <TextInput
            className="flex-1 font-sans text-base text-foreground placeholder:text-muted-foreground"
            value={search}
            onChangeText={setSearch}
            placeholder="Search chats"
            aria-label="Search chats"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {search ? (
            <Pressable role="button" aria-label="Clear search" onPress={() => setSearch("")}>
              <Icon as={IconX} className="size-4.5 text-muted-foreground" />
            </Pressable>
          ) : null}
        </View>
      </View>
      {pages.isPending && pages.fetchStatus === "paused" ? (
        <Text className="p-6 text-center text-muted-foreground">
          You’re offline. Your chats load when you reconnect.
        </Text>
      ) : null}
      {pages.isPending && pages.fetchStatus === "fetching" ? <ActivityIndicator className="mt-8" /> : null}
      {pages.isError ? (
        <View className="items-center gap-3 p-6">
          <Text className="text-center">Couldn’t load your chats.</Text>
          <Button variant="outline" onPress={() => void pages.refetch()}>
            <Text>Try again</Text>
          </Button>
        </View>
      ) : null}
      {pages.isSuccess ? (
        <LegendList
          data={chats}
          keyExtractor={(chat) => chat.id}
          renderItem={(row) => (
            <ChatRow
              chat={row.item}
              time
              onPress={() => router.navigate({ pathname: "/chat/[id]", params: { id: row.item.id } })}
            />
          )}
          estimatedItemSize={44}
          recycleItems
          keyboardDismissMode="on-drag"
          refreshing={pulling}
          onRefresh={() => void refresh()}
          onEndReached={() => {
            if (pages.hasNextPage && !pages.isFetchingNextPage) void pages.fetchNextPage()
          }}
          ListEmptyComponent={
            <Empty search={needle} onClear={() => setSearch("")} onNew={() => router.navigate("/")} />
          }
          ListFooterComponent={pages.isFetchingNextPage ? <ActivityIndicator className="py-4" /> : null}
        />
      ) : null}
      <View className="absolute inset-x-0 bottom-0 items-end px-5 pb-safe-offset-5" pointerEvents="box-none">
        <NewChatButton />
      </View>
    </View>
  )
}
