import "../global.css"
import { QueryClientProvider, useQuery } from "@tanstack/react-query"
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, type ErrorBoundaryProps } from "expo-router"
import type { Theme } from "expo-router/react-navigation"
import { hide, preventAutoHideAsync } from "expo-splash-screen"
import { StatusBar } from "expo-status-bar"
import { setBackgroundColorAsync } from "expo-system-ui"
import { useEffect } from "react"
import { View } from "react-native"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { KeyboardProvider } from "react-native-keyboard-controller"
import { SafeAreaListener } from "react-native-safe-area-context"
import { Uniwind, useCSSVariable, useUniwind, withUniwind } from "uniwind"
import { Button } from "#components/button"
import { Text } from "#components/text"
import { AppUpdates } from "#lib/app-updates"
import { Auth } from "#lib/auth"
import { Preferences } from "#lib/preferences"
import { Queries } from "#lib/queries"

const applyTheme = () => Uniwind.setTheme(Preferences.theme.get())
applyTheme()
Preferences.theme.subscribe(applyTheme)

void preventAutoHideAsync()

const RootView = withUniwind(GestureHandlerRootView)
const InsetsView = withUniwind(SafeAreaListener)

const color = (value: string | number | undefined, fallback: Theme["colors"][keyof Theme["colors"]]) =>
  typeof value === "string" ? value : fallback

function Routes() {
  const session = useQuery(Auth.sessionOptions)
  const offline = session.isPending && session.fetchStatus === "paused"
  const loading = session.isPending && !offline
  useEffect(() => {
    if (!loading) hide()
  }, [loading])
  if (loading) return null
  if (offline || session.isError)
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <Text className="text-center">
          {offline
            ? "You’re offline. Connect to continue."
            : "Couldn’t reach Ren. Check your connection and try again."}
        </Text>
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

export function ErrorBoundary(props: ErrorBoundaryProps) {
  return (
    <View className="flex-1 items-center justify-center gap-4 bg-background p-6">
      <Text className="text-center">Unable to show this screen. Try again.</Text>
      <Button variant="outline" onPress={() => void props.retry()}>
        <Text>Try again</Text>
      </Button>
    </View>
  )
}

export default function RootLayout() {
  AppUpdates.useAutoApply()
  const dark = useUniwind().theme === "dark"
  const base = dark ? DarkTheme : DefaultTheme
  const background = useCSSVariable("--color-background")
  const foreground = useCSSVariable("--color-foreground")
  const border = useCSSVariable("--color-border")
  const primary = useCSSVariable("--color-primary")
  const destructive = useCSSVariable("--color-destructive")
  useEffect(() => {
    if (typeof background === "string") void setBackgroundColorAsync(background)
  }, [background])
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
      <InsetsView className="flex-1" onChange={(event) => Uniwind.updateInsets(event.insets)}>
        <QueryClientProvider client={Queries.client}>
          <KeyboardProvider>
            <ThemeProvider value={theme}>
              <StatusBar style={dark ? "light" : "dark"} />
              <Routes />
            </ThemeProvider>
          </KeyboardProvider>
        </QueryClientProvider>
      </InsetsView>
    </RootView>
  )
}
