import { Stack } from "expo-router"

export default function DriveLayout() {
  return (
    <Stack screenOptions={{ headerShadowVisible: false }}>
      <Stack.Screen
        name="index"
        options={{ title: "Drive" }}
        dangerouslySingular={(_name, params) => `${String(params.space ?? "")}:${String(params.folder ?? "")}`}
      />
      <Stack.Screen name="file" options={{ title: "", presentation: "fullScreenModal" }} />
      <Stack.Screen name="artifacts" options={{ title: "Artifacts" }} />
    </Stack>
  )
}
