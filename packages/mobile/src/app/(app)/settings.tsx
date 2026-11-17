import { TimelineDetail } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import Constants from "expo-constants"
import { isEnabled, useUpdates } from "expo-updates"
import { useState, type ReactNode } from "react"
import { Alert, Pressable, ScrollView, Switch, View } from "react-native"
import CheckIcon from "react-native-heroicons/mini/CheckIcon"
import ChevronRightIcon from "react-native-heroicons/mini/ChevronRightIcon"
import { Avatar } from "#components/avatar"
import { Icon } from "#components/icon"
import { OrgSwitcher } from "#components/org-switcher"
import { Segmented } from "#components/segmented"
import { Sheet } from "#components/sheet"
import { Text } from "#components/text"
import { AppUpdates } from "#lib/app-updates"
import { Auth } from "#lib/auth"
import { Preferences } from "#lib/preferences"

const themes = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const satisfies ReadonlyArray<{ readonly value: (typeof Preferences.themes)[number]; readonly label: string }>

function Section(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <View className="gap-2">
      <Text role="heading" aria-level={2} className="px-1 text-sm font-medium text-muted-foreground">
        {props.title}
      </Text>
      <View className="overflow-hidden rounded-xl bg-card">{props.children}</View>
    </View>
  )
}

function SwitchRow(props: {
  readonly title: string
  readonly description?: string
  readonly preference: Preferences.Info<boolean>
}) {
  const [checked, setChecked] = Preferences.usePreference(props.preference)
  return (
    <View className="min-h-12 flex-row items-center gap-3 px-4 py-3">
      <View className="flex-1 gap-0.5">
        <Text>{props.title}</Text>
        {props.description ? <Text variant="muted">{props.description}</Text> : null}
      </View>
      <Switch
        aria-label={props.title}
        value={checked}
        onValueChange={setChecked}
        trackColorOnClassName="accent-ring"
        trackColorOffClassName="accent-muted"
        thumbColorClassName="accent-white"
      />
    </View>
  )
}

function TimelineDetailRow() {
  const [detail, setDetail] = Preferences.usePreference(Preferences.timelineDetail)
  const [open, setOpen] = useState(false)
  const preset = TimelineDetail.preset(detail)
  return (
    <>
      <Pressable
        role="button"
        aria-label={`Timeline detail: ${preset?.label ?? "Custom"}`}
        className="min-h-12 flex-row items-center gap-3 px-4 py-3 active:bg-accent"
        onPress={() => setOpen(true)}
      >
        <Text className="flex-1">Timeline detail</Text>
        <Text className="text-muted-foreground">{preset?.label ?? "Custom"}</Text>
        <Icon as={ChevronRightIcon} className="size-4.5 text-muted-foreground" />
      </Pressable>
      <Sheet open={open} onClose={() => setOpen(false)}>
        <Text role="heading" aria-level={2} className="px-5 pb-2 text-base font-semibold">
          Timeline detail
        </Text>
        <ScrollView role="radiogroup">
          {TimelineDetail.presets.map((item) => (
            <Pressable
              key={item.id}
              role="radio"
              aria-checked={item.id === preset?.id}
              className="flex-row items-center gap-3 px-5 py-3 active:bg-accent"
              onPress={() => {
                setDetail(item.value)
                setOpen(false)
              }}
            >
              <View className="flex-1 gap-0.5">
                <Text className="font-medium">{item.label}</Text>
                <Text variant="muted">{item.description}</Text>
              </View>
              {item.id === preset?.id ? <Icon as={CheckIcon} className="size-4.5" /> : null}
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>
    </>
  )
}

const updateStatus = (updates: ReturnType<typeof useUpdates>, options: { readonly checked: boolean }) => {
  if (updates.isUpdatePending) return "Restart to update"
  if (updates.isDownloading) return "Downloading…"
  if (updates.isChecking) return "Checking…"
  if (updates.checkError) return "Couldn’t check. Try again"
  return options.checked ? "Up to date" : "Check for updates"
}

function AboutRows() {
  const updates = useUpdates()
  const [checked, setChecked] = useState(false)
  const running = updates.currentlyRunning
  const build = running.isEmbeddedLaunch
    ? "Built in"
    : `Update ${running.updateId?.slice(0, 8) ?? ""}${running.createdAt ? ` · ${running.createdAt.toLocaleDateString()}` : ""}`
  return (
    <>
      <View className="min-h-12 flex-row items-center gap-3 px-4 py-3">
        <Text className="flex-1">Version</Text>
        <Text className="text-muted-foreground">{Constants.expoConfig?.version ?? ""}</Text>
      </View>
      {isEnabled ? (
        <>
          <View className="mx-4 h-px bg-border" />
          <View className="min-h-12 flex-row items-center gap-3 px-4 py-3">
            <Text className="flex-1">Running</Text>
            <Text className="text-muted-foreground">{build}</Text>
          </View>
          <View className="mx-4 h-px bg-border" />
          <Pressable
            role="button"
            disabled={updates.isChecking || updates.isDownloading}
            className="min-h-12 flex-row items-center px-4 py-3 active:bg-accent"
            onPress={() => {
              if (updates.isUpdatePending) return void AppUpdates.apply()
              void AppUpdates.fetchLatest()
                .catch(() => undefined)
                .then(() => setChecked(true))
            }}
          >
            <Text className="font-medium text-link">{updateStatus(updates, { checked })}</Text>
          </Pressable>
        </>
      ) : null}
    </>
  )
}

export default function Settings() {
  const queryClient = useQueryClient()
  const user = useQuery(Auth.sessionOptions).data?.user
  const [theme, setTheme] = Preferences.usePreference(Preferences.theme)
  const name = user?.name || user?.email || ""

  const logOut = async () => {
    await Auth.client.signOut()
    await Auth.refreshSession(queryClient)
    ChatReact.forget()
  }
  const confirmLogOut = () =>
    Alert.alert("Log out?", "You’ll need to sign in again to access Ren.", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: () => void logOut() },
    ])

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-6 px-4 pt-2 pb-safe-offset-6">
      <Section title="Appearance">
        <View className="gap-3 px-4 py-3">
          <Text>Theme</Text>
          <Segmented label="Theme" options={themes} value={theme} onChange={setTheme} />
        </View>
      </Section>
      <Section title="Chat">
        <TimelineDetailRow />
        <View className="mx-4 h-px bg-border" />
        <SwitchRow
          title="Fold finished turns"
          description="Collapse the steps into “Worked for…”."
          preference={Preferences.foldTurns}
        />
        <View className="mx-4 h-px bg-border" />
        <SwitchRow title="Fold long messages" preference={Preferences.foldMessages} />
      </Section>
      <Section title="Account">
        <View className="flex-row items-center gap-3 px-4 py-3">
          <Avatar name={name} />
          <View className="flex-1">
            <Text className="font-medium" numberOfLines={1}>
              {name}
            </Text>
            <Text variant="muted" numberOfLines={1}>
              {user?.email ?? ""}
            </Text>
          </View>
        </View>
        <View className="mx-4 h-px bg-border" />
        <OrgSwitcher />
        <View className="mx-4 h-px bg-border" />
        <Pressable
          role="button"
          className="min-h-12 flex-row items-center px-4 py-3 active:bg-accent"
          onPress={confirmLogOut}
        >
          <Text className="font-medium text-destructive">Log out</Text>
        </Pressable>
      </Section>
      <Section title="About">
        <AboutRows />
      </Section>
    </ScrollView>
  )
}
