import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useRouter } from "expo-router"
import { useState } from "react"
import { ActivityIndicator, View } from "react-native"
import { KeyboardStickyView } from "react-native-keyboard-controller"
import { withUniwind } from "uniwind"
import { Composer } from "#components/composer"
import { Text } from "#components/text"
import { Api } from "#lib/api"

const StickyView = withUniwind(KeyboardStickyView)

export default function NewChat() {
  const router = useRouter()
  const atoms = ChatReact.useAtoms()
  const spaces = useQuery(Api.query.space.list.queryOptions({ joined: true, page: 1, pageSize: 50 }))
  const space = spaces.data?.items.at(0)
  const prepare = useMutation(Api.query.chat.prepare.mutationOptions())
  const create = useMutation(Api.query.session.create.mutationOptions())
  const [sessionId, setSessionId] = useState(() => Session.ID.create())
  const [text, setText] = useState("")
  const [error, setError] = useState("")

  const type = (next: string) => {
    setText(next)
    if (space && next.trim() && prepare.isIdle) prepare.mutate({ id: space.id })
  }
  const send = () => {
    const trimmed = text.trim()
    if (!trimmed || !space || create.isPending) return
    const message = { id: SessionMessage.ID.create(), text: trimmed }
    setError("")
    create.mutate(
      { id: sessionId, spaceId: space.id, message },
      {
        onSuccess: () => {
          atoms.handoff(sessionId, message)
          setText("")
          setSessionId(Session.ID.create())
          router.navigate({ pathname: "/chat/[id]", params: { id: sessionId } })
        },
        onError: () => {
          setSessionId(Session.ID.create())
          setError("Couldn’t start the chat. Try again.")
        },
      },
    )
  }

  return (
    <View className="flex-1 bg-background">
      <View className="flex-1 items-center justify-center p-6">
        {spaces.isPending && spaces.fetchStatus === "paused" ? (
          <Text className="text-center text-muted-foreground">You’re offline. Connect to start a chat.</Text>
        ) : null}
        {spaces.isSuccess && !space ? (
          <Text className="text-center text-muted-foreground">Join a space on the web to start a chat.</Text>
        ) : null}
      </View>
      <StickyView className="absolute inset-x-0 bottom-0">
        {error ? <Text className="bg-background px-5 pt-2 text-sm text-destructive">{error}</Text> : null}
        <View className="flex-row items-center gap-2 bg-background px-5 pt-2">
          {create.isPending ? <ActivityIndicator size="small" /> : null}
          {space ? <Text className="text-sm text-muted-foreground">Working in {space.name}</Text> : null}
        </View>
        <Composer value={text} onChange={type} onSend={send} onStop={send} running={false} />
      </StickyView>
    </View>
  )
}
