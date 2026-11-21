import { Stack } from "expo-router"
import { MenuButton } from "#components/header-button"

export default function TasksLayout() {
  return (
    <Stack screenOptions={{ headerShadowVisible: false }}>
      <Stack.Screen
        name="index"
        options={{
          title: "Tasks",
          headerLeft: () => <MenuButton />,
        }}
      />
      <Stack.Screen name="[id]" options={{ title: "" }} />
    </Stack>
  )
}
