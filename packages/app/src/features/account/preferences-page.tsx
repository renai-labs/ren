import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "@ren/ui/sonner"
import { Button } from "@ren/ui/button"
import { Switch } from "@ren/ui/switch"
import { Preference } from "../../lib/preference.js"
import { ConfirmDialog } from "../../components/confirm-dialog.js"
import { EditableText } from "../../components/editable-text.js"
import { Page, Row, Rows, Section } from "../../components/page.js"
import { useMe } from "../../lib/use-me.js"
import { errorMessage } from "../../lib/errors.js"
import { resetSession } from "../../lib/chat.js"
import { ChatPreferences } from "../../lib/chat-preferences.js"
import {
  backgroundActivities,
  deliveries,
  PasswordDialog,
  ThemePicker,
  timelineWidths,
} from "../../components/settings-shared.js"
import { ChoiceRow, SwitchRow } from "../../components/preference-rows.js"
import { RouterContext } from "../../lib/router-context.js"
import { AvatarPicker } from "../../components/avatar-picker.js"
import { TimeZone } from "../../lib/time-zone.js"
import { TimeZonePicker } from "../../components/time-zone-picker.js"
import { AppearancePreferences } from "../../lib/appearance-preferences.js"
import { TimelineDetailSetting } from "./timeline-detail-setting.js"
import { TypographySection } from "./typography-section.js"

const resettable = [
  AppearancePreferences.theme,
  AppearancePreferences.uiFont,
  AppearancePreferences.uiSize,
  AppearancePreferences.codeFont,
  AppearancePreferences.codeSize,
  ChatPreferences.timelineDetail,
  ChatPreferences.foldTurns,
  ChatPreferences.foldMessages,
  ChatPreferences.timelineWidth,
  ChatPreferences.backgroundActivity,
  ChatPreferences.followUp,
  ChatPreferences.notifications,
  TimeZone.chosen,
]

const notificationRows = [
  { kind: "finished", title: "Ren finishes", description: "When Ren is done." },
  { kind: "permissions", title: "Permissions", description: "When Ren needs a permission." },
  { kind: "questions", title: "Questions", description: "When Ren asks a question." },
  { kind: "errors", title: "Errors", description: "When a turn fails." },
] as const satisfies ReadonlyArray<{ kind: ChatPreferences.NotificationKind; title: string; description: string }>

export function PreferencesPage() {
  const { api, auth, platform, queryClient } = RouterContext.useRouterContext()
  const me = useMe()
  const notifications = Preference.usePreference(ChatPreferences.notifications)
  const [permission, setPermission] = useState(() => platform.notificationPermission?.())
  const timeZone = Preference.usePreference(TimeZone.chosen) ?? ""
  const setPreference = Preference.useSetPreference()
  const allDefault = Preference.useAllDefault(resettable)
  const reset = Preference.useReset(resettable)
  const rename = useMutation({
    mutationFn: async (name: string) => {
      const result = await auth.updateUser({ name })
      if (result.error !== null) throw new Error(result.error.message ?? "Failed to change your name")
    },
    // ast-grep-ignore: no-manual-invalidation -- Better Auth changes the user
    onSuccess: () => queryClient.invalidateQueries({ queryKey: api.me.get.queryKey() }),
    onError: (error) => toast.error("Couldn’t change your name", { description: errorMessage(error) }),
  })
  const photo = useMutation({
    mutationFn: async (image: string | null) => {
      const result = await auth.updateUser({ image })
      if (result.error !== null) throw new Error(result.error.message ?? "Failed to change your photo")
    },
    // ast-grep-ignore: no-manual-invalidation -- Better Auth changes the user
    onSuccess: () => queryClient.invalidateQueries({ queryKey: api.me.get.queryKey() }),
    onError: (error) => toast.error("Couldn’t change your photo", { description: errorMessage(error) }),
  })
  const navigate = useNavigate()
  const [leaving, setLeaving] = useState(false)
  const user = me.user
  const organization = me.organization
  const leave = async () => {
    const result = await auth.organization.leave({ organizationId: me.organization.id })
    if (result.error !== null) {
      toast.error("Couldn’t leave the organization", { description: result.error.message ?? undefined })
      return
    }
    toast.success(`You left ${me.organization.name}`)
    resetSession(queryClient)
    await navigate({ to: "/" })
  }
  const changeNotification = async (
    key: ChatPreferences.NotificationKind | "sound",
    change: { readonly enabled: boolean },
  ) => {
    if (change.enabled && key !== "sound") {
      const granted = await platform.requestNotifications?.()
      setPermission(platform.notificationPermission?.())
      if (granted === false) return
    }
    setPreference(ChatPreferences.notifications, {
      ...ChatPreferences.notifications.read(platform.storage),
      [key]: change.enabled,
    })
  }
  return (
    <Page
      title="Preferences"
      actions={
        <Button
          variant="outline"
          disabled={allDefault}
          onClick={() => {
            const undo = reset()
            toast.success("Preferences reset to defaults", { action: { label: "Undo", onClick: undo } })
          }}
        >
          Reset to defaults
        </Button>
      }
    >
      <Rows>
        {[
          <Row key="photo" title="Photo">
            <AvatarPicker
              kind="person"
              label="Your photo"
              name={user.name || user.email}
              value={user.image}
              onChange={(image) => photo.mutateAsync(image)}
            />
          </Row>,
          <Row key="name" title="Name">
            <EditableText
              value={user.name}
              label="name"
              required
              onCommit={(name: string) => rename.mutateAsync(name)}
            />
          </Row>,
          <Row key="email" title="Email" description="Contact support to change.">
            <span className="text-sm text-muted-foreground">{user.email}</span>
          </Row>,
        ]}
      </Rows>
      <Section title="Appearance">
        <Rows>{[<ThemePicker key="theme" />]}</Rows>
      </Section>
      <TypographySection />
      <Section title="Timeline">
        <Rows>
          {[
            <TimelineDetailSetting key="detail" />,
            <SwitchRow
              key="fold-turns"
              title="Fold finished turns"
              description="Collapse the steps into “Worked for…”."
              preference={ChatPreferences.foldTurns}
            />,
            <SwitchRow key="fold-messages" title="Fold long messages" preference={ChatPreferences.foldMessages} />,
            <ChoiceRow
              key="timeline-width"
              title="Timeline width"
              preference={ChatPreferences.timelineWidth}
              options={timelineWidths}
            />,
            <ChoiceRow
              key="background"
              title="Background activity"
              description="Running subagents and shells, above the composer."
              preference={ChatPreferences.backgroundActivity}
              options={backgroundActivities}
            />,
          ]}
        </Rows>
      </Section>
      <Section title="Chats">
        <Rows>
          {[
            <ChoiceRow
              key="delivery"
              title="Messages sent while Ren works"
              preference={ChatPreferences.followUp}
              options={deliveries}
            />,
          ]}
        </Rows>
      </Section>
      <Section title="Notifications">
        {permission === "denied" ? (
          <p className="text-xs text-muted-foreground">
            Your browser blocks notifications from Ren. Allow them in its site settings.
          </p>
        ) : null}
        <Rows>
          {[
            ...notificationRows.map((row) => (
              <Row key={row.kind} title={row.title} description={row.description}>
                <Switch
                  checked={notifications[row.kind]}
                  disabled={permission === "denied"}
                  onCheckedChange={(enabled) => void changeNotification(row.kind, { enabled })}
                  aria-label={row.title}
                />
              </Row>
            )),
            <Row key="sound" title="Play a sound" description="With every notification.">
              <Switch
                checked={notifications.sound}
                disabled={permission === "denied" || notificationRows.every((row) => !notifications[row.kind])}
                onCheckedChange={(enabled) => void changeNotification("sound", { enabled })}
                aria-label="Play a sound"
              />
            </Row>,
          ]}
        </Rows>
      </Section>
      <Section title="Time">
        <Rows>
          {[
            <Row key="time-zone" title="Timezone" description="New schedules start in this timezone.">
              <TimeZonePicker
                automatic
                value={timeZone}
                variant="ghost"
                className="gap-2 text-muted-foreground"
                onChange={(value) => setPreference(TimeZone.chosen, value || null)}
              />
            </Row>,
          ]}
        </Rows>
      </Section>
      <Section title="Security">
        <Rows>
          {[
            <Row key="password" title="Password">
              <PasswordDialog />
            </Row>,
          ]}
        </Rows>
      </Section>
      <Section title="Organization">
        <Rows>
          {[
            <Row key="leave" title={organization.name}>
              <Button variant="outline" size="sm" onClick={() => setLeaving(true)}>
                Leave organization
              </Button>
            </Row>,
          ]}
        </Rows>
        <ConfirmDialog
          open={leaving}
          onOpenChange={setLeaving}
          confirmation={{
            title: `Leave ${organization.name}?`,
            description:
              "You lose access to its spaces and chats. Your private space is archived and your personal credentials here are deleted.",
            action: "Leave",
          }}
          onConfirm={leave}
        />
      </Section>
    </Page>
  )
}
