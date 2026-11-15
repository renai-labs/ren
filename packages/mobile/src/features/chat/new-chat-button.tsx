import PencilSquareIcon from "react-native-heroicons/mini/PencilSquareIcon"
import { useRouter } from "expo-router"
import { Button } from "#components/button"
import { Icon } from "#components/icon"
import { Text } from "#components/text"

function NewChatButton() {
  const router = useRouter()
  return (
    <Button className="h-12 rounded-full px-5 shadow-soft dark:shadow-none" onPress={() => router.navigate("/")}>
      <Icon as={PencilSquareIcon} className="size-5" />
      <Text>New chat</Text>
    </Button>
  )
}

export { NewChatButton }
