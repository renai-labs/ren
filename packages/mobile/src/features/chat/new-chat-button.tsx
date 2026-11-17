import PlusIcon from "react-native-heroicons/mini/PlusIcon"
import { useRouter } from "expo-router"
import { Button } from "#components/button"
import { Icon } from "#components/icon"
import { Text } from "#components/text"

function NewChatButton(props: { readonly onPress?: () => void }) {
  const router = useRouter()
  return (
    <Button
      className="h-12 rounded-full px-5 shadow-soft dark:shadow-none"
      onPress={() => {
        router.navigate("/")
        props.onPress?.()
      }}
    >
      <Icon as={PlusIcon} className="size-5" />
      <Text className="text-base">New chat</Text>
    </Button>
  )
}

export { NewChatButton }
