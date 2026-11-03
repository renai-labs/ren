import IconEdit from "@tabler/icons-react-native/IconEdit"
import { useRouter } from "expo-router"
import { Button } from "#components/button"
import { Icon } from "#components/icon"

function NewChatButton() {
  const router = useRouter()
  return (
    <Button
      size="icon"
      aria-label="New chat"
      className="size-14 rounded-full shadow-lg"
      onPress={() => router.navigate("/")}
    >
      <Icon as={IconEdit} className="size-6" />
    </Button>
  )
}

export { NewChatButton }
