import { Button } from "@ren/ui/button"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import { Field } from "@ren/ui/field"
import { InlineEdit } from "@ren/ui/inline-edit"
import { PageShell } from "@ren/ui/page-shell"
import { Select } from "@ren/ui/select"
import { Switch } from "@ren/ui/switch"
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
import { useAccountLink } from "../../lib/use-account-link.js"

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
  const [notify, setNotify] = useState(() => ChatPreferences.notify.read(platform.storage))
  return (
    <PageShell.Section title="Chats" frame="divided">
      <Field.Root label="Detail" description="How much of Ren’s work a chat shows." orientation="horizontal">
        <Select.Root
          value={detail}
          options={detailOptions}
          appearance="filled"
          size="small"
          onValueChange={(next) => {
            if (next === detail) return
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
      {platform.requestNotifications ? (
        <Field.Root
          label="Notify me when Ren finishes or needs input"
          description="Only while Ren’s tab is in the background."
          orientation="horizontal"
        >
          <Switch
            checked={notify}
            onCheckedChange={(enabled) => {
              ChatPreferences.notify.write(platform.storage, enabled)
              setNotify(enabled)
              if (!enabled) return
              void platform.requestNotifications?.().then((allowed) => {
                if (!allowed)
                  Toast.manager.add({
                    type: "error",
                    title: "Notifications are blocked",
                    description: "Allow notifications for Ren in your browser’s site settings.",
                  })
              })
            }}
          />
        </Field.Root>
      ) : null}
    </PageShell.Section>
  )
}

const linkedDescriptions = {
  github: {
    linked: "Ren runs your GitHub mentions as you, with your GitHub access.",
    unlinked: "Link it so Ren runs your GitHub mentions as you, with your GitHub access.",
  },
  slack: {
    linked: "Ren knows your Slack messages are yours, in any channel it answers.",
    unlinked: "Link it so Ren knows your Slack messages are yours, even when your Slack email differs.",
  },
} as const

function LinkedAccounts() {
  const github = useAccountLink("github", "/settings/preferences")
  const slack = useAccountLink("slack", "/settings/preferences")
  const offered = [github, slack].filter((link) => link.offered)
  if (offered.length === 0) return null
  return (
    <PageShell.Section title="Linked accounts" frame="divided">
      {offered.map((link) => (
        <LinkedAccount key={link.provider} link={link} />
      ))}
    </PageShell.Section>
  )
}

// oxlint-disable-next-line ren/no-comments -- access AC2: any member leaves; Better Auth refuses the last owner.
function LeaveOrganization(props: { organization: { id: string; name: string } }) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  return (
    <PageShell.Section title="Organization" frame="divided">
      <Field.Root
        label={props.organization.name}
        description="Leaving archives your private space and deletes your personal credentials here."
        orientation="horizontal"
      >
        <Button appearance="outline" size="small" onClick={() => setConfirming(true)}>
          Leave organization
        </Button>
      </Field.Root>
      <ConfirmationDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Leave ${props.organization.name}?`}
        description="You lose access to its spaces and chats. Your private space is archived and your personal credentials here are deleted."
        confirmLabel="Leave"
        tone="danger"
        onConfirm={async () => {
          const result = await context.auth.organization.leave({ organizationId: props.organization.id })
          if (result.error !== null) throw new Error(result.error.message ?? "Couldn’t leave the organization")
          await Promise.all(
            [Auth.sessionOptions(context.auth).queryKey, context.api.me.get.queryKey()].map((queryKey) =>
              // ast-grep-ignore: no-manual-invalidation -- Better Auth changes the user and the session
              queryClient.invalidateQueries({ queryKey }),
            ),
          )
        }}
        onConfirmed={() => Toast.manager.add({ type: "success", title: `You left ${props.organization.name}` })}
      />
    </PageShell.Section>
  )
}

function LinkedAccount(props: { link: ReturnType<typeof useAccountLink> }) {
  const link = props.link
  return (
    <Field.Root
      label={link.title}
      description={linkedDescriptions[link.provider][link.linked ? "linked" : "unlinked"]}
      orientation="horizontal"
    >
      {link.linked ? (
        <Button appearance="outline" size="small" pending={link.unlink.isPending} onClick={() => link.unlink.mutate()}>
          Disconnect {link.title}
        </Button>
      ) : (
        <Button
          appearance="outline"
          size="small"
          pending={link.link.isPending}
          disabled={link.loading}
          onClick={() => link.link.mutate()}
        >
          Connect {link.title}
        </Button>
      )}
    </Field.Root>
  )
}

export function Preferences(props: {
  user: { name: string; email: string }
  organization: { id: string; name: string } | null
}) {
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
              await Promise.all(
                [Auth.sessionOptions(context.auth).queryKey, context.api.me.get.queryKey()].map((queryKey) =>
                  // ast-grep-ignore: no-manual-invalidation -- Better Auth changes the user and the session
                  queryClient.invalidateQueries({ queryKey }),
                ),
              )
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
      <LinkedAccounts />
      {props.organization ? <LeaveOrganization organization={props.organization} /> : null}
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
