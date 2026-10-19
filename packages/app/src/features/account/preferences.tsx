import { Button } from "@ren/ui/button"
import { Field } from "@ren/ui/field"
import { InlineEdit } from "@ren/ui/inline-edit"
import { PageShell } from "@ren/ui/page-shell"
import { Select } from "@ren/ui/select"
import { Text } from "@ren/ui/text"
import { Theme } from "@ren/ui/theme"
import { ThemeSelector } from "@ren/ui/theme-selector"
import { Toast } from "@ren/ui/toast"
import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Auth } from "../../lib/auth.js"
import { ChatPreferences } from "../../lib/chat-preferences.js"
import { Forms } from "../../lib/forms.js"
import { RouterContext } from "../../lib/router-context.js"
import { Platform } from "../../platform/platform.js"
import { PasswordDialog } from "./password-dialog.js"

const detailOptions: ReadonlyArray<Select.Option<ChatPreferences.Detail>> = [
  { value: "standard", label: "Standard" },
  { value: "everything", label: "Everything" },
  { value: "detailed", label: "Detailed" },
  { value: "compact", label: "Compact" },
  { value: "quiet", label: "Quiet" },
  { value: "text-only", label: "Text only" },
]

const followUpOptions: ReadonlyArray<Select.Option<ChatPreferences.FollowUp>> = [
  { value: "steer", label: "Steer the current turn" },
  { value: "queue", label: "Queue for the next turn" },
]

function ChatSettings() {
  const platform = Platform.usePlatform()
  const [detail, setDetail] = useState(() => ChatPreferences.detail.read(platform.storage))
  const [followUp, setFollowUp] = useState(() => ChatPreferences.followUp.read(platform.storage))
  return (
    <PageShell.Section title="Chats" frame="divided">
      <Field.Root label="Detail" description="How much of Ren’s work a chat shows." orientation="horizontal">
        <Select.Root
          value={detail}
          options={detailOptions}
          appearance="filled"
          size="small"
          onValueChange={(next) => {
            ChatPreferences.detail.write(platform.storage, next)
            setDetail(next)
            void import("../../lib/chat.js").then((loaded) => loaded.Chat.forget())
          }}
        />
      </Field.Root>
      <Field.Root
        label="Messages sent while Ren works"
        description="Steering adds them to the current turn. Queued messages wait for it to finish."
        orientation="horizontal"
      >
        <Select.Root
          value={followUp}
          options={followUpOptions}
          appearance="filled"
          size="small"
          onValueChange={(next) => {
            ChatPreferences.followUp.write(platform.storage, next)
            setFollowUp(next)
          }}
        />
      </Field.Root>
    </PageShell.Section>
  )
}

export function Preferences(props: { user: { name: string; email: string } }) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const theme = Theme.useTheme()
  const [changingPassword, setChangingPassword] = useState(false)
  return (
    <PageShell.Root layout="settings" title="Preferences">
      <PageShell.Section frame="divided">
        <Field.Root label="Email" description="Contact support to change." orientation="row">
          <div className="min-w-0">
            <Text tone="secondary" wrapping="anywhere" element="span">
              {props.user.email}
            </Text>
          </div>
        </Field.Root>
        <Field.Root label="Name" orientation="horizontal">
          <InlineEdit
            label="Name"
            alignment="end"
            value={props.user.name}
            placeholder="Add your name"
            schema={Forms.userName}
            onCommit={async (name) => {
              const result = await context.auth.updateUser({ name })
              if (result.error !== null) {
                const message = result.error.message ?? "Try again."
                Toast.manager.add({ type: "error", title: "Couldn’t update profile", description: message })
                throw new Error(message)
              }
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: Auth.sessionOptions(context.auth).queryKey }),
                queryClient.invalidateQueries({ queryKey: context.api.me.get.queryKey() }),
              ])
            }}
          />
        </Field.Root>
      </PageShell.Section>
      <PageShell.Section title="Appearance" frame="divided">
        <Field.Root label="Theme">
          <ThemeSelector value={theme.preference} onValueChange={theme.setPreference} />
        </Field.Root>
      </PageShell.Section>
      <ChatSettings />
      <PageShell.Section title="Security" frame="divided">
        <Field.Root label="Password" orientation="row">
          <Button appearance="outline" size="small" onClick={() => setChangingPassword(true)}>
            Change
          </Button>
        </Field.Root>
      </PageShell.Section>
      {changingPassword ? <PasswordDialog onClose={() => setChangingPassword(false)} /> : null}
    </PageShell.Root>
  )
}
