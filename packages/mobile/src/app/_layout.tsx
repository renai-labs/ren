import "../global.css"
import { QueryClientProvider, useQuery } from "@tanstack/react-query"
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router"
import type { Theme } from "expo-router/react-navigation"
import { StatusBar } from "expo-status-bar"
import { View } from "react-native"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { KeyboardProvider } from "react-native-keyboard-controller"
import { useCSSVariable, useUniwind, withUniwind } from "uniwind"
import { Button } from "#components/button"
import { Text } from "#components/text"
import { Auth } from "#lib/auth"
import { Queries } from "#lib/queries"

const RootView = withUniwind(GestureHandlerRootView)

const color = (value: string | number | undefined, fallback: Theme["colors"][keyof Theme["colors"]]) =>
  typeof value === "string" ? value : fallback

function Routes() {
  const session = useQuery(Auth.sessionOptions)
  if (session.isPending) return null
  if (session.isError)
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <Text className="text-center">Couldn’t reach Ren. Check your connection and try again.</Text>
        <Button variant="outline" onPress={() => void session.refetch()}>
          <Text>Try again</Text>
        </Button>
      </View>
    )
  return (
    <Stack>
      <Stack.Protected guard={Boolean(session.data)}>
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!session.data}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  )
}

export default function RootLayout() {
  const dark = useUniwind().theme === "dark"
  const base = dark ? DarkTheme : DefaultTheme
  const background = useCSSVariable("--color-background")
  const foreground = useCSSVariable("--color-foreground")
  const border = useCSSVariable("--color-border")
  const primary = useCSSVariable("--color-primary")
  const destructive = useCSSVariable("--color-destructive")
  const theme: Theme = {
    ...base,
    colors: {
      background: color(background, base.colors.background),
      card: color(background, base.colors.card),
      text: color(foreground, base.colors.text),
      border: color(border, base.colors.border),
      primary: color(primary, base.colors.primary),
      notification: color(destructive, base.colors.notification),
    },
  }
  return (
    <RootView className="flex-1">
      <QueryClientProvider client={Queries.client}>
        <KeyboardProvider>
          <ThemeProvider value={theme}>
            <StatusBar style={dark ? "light" : "dark"} />
            <Routes />
          </ThemeProvider>
        </KeyboardProvider>
      </QueryClientProvider>
    </RootView>
  )
}
