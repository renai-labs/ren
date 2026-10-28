import { Button } from "@ren/ui/button"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@ren/ui/field"
import { InlineEdit } from "@ren/ui/inline-edit"
import { Page } from "@ren/ui/page"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Spinner } from "@ren/ui/spinner"
import { Switch } from "@ren/ui/switch"
import { Text } from "@ren/ui/text"
import { Theme } from "@ren/ui/theme"
import { ThemeSelector } from "@ren/ui/theme-selector"
import { toast } from "@ren/ui/toast"
import { useQueryClient } from "@tanstack/react-query"
import { useId, useState } from "react"
import type { ReactNode } from "react"
import { Auth } from "../../lib/auth.js"
import { ChatPreferences } from "../../lib/chat-preferences.js"
import { Forms } from "../../lib/forms.js"
import { RouterContext } from "../../lib/router-context.js"
import { Platform } from "../../platform/platform.js"
import { PasswordDialog } from "./password-dialog.js"
import { useAccountLink } from "../../lib/use-account-link.js"

const detailOptions: ReadonlyArray<{ value: ChatPreferences.Detail; label: string }> = [
  { value: "standard", label: "Standard" },
  { value: "everything", label: "Everything" },
  { value: "detailed", label: "Detailed" },
  { value: "compact", label: "Compact" },
  { value: "quiet", label: "Quiet" },
  { value: "text-only", label: "Text only" },
]

const followUpOptions: ReadonlyArray<{ value: ChatPreferences.FollowUp; label: string }> = [
  { value: "steer", label: "Steer the current turn" },
  { value: "queue", label: "Queue for the next turn" },
]

function Setting(props: { title: string; description?: string; controlId?: string; children: ReactNode }) {
  return (
    <Field orientation="horizontal" className="has-[>[data-slot=field-content]]:items-center">
      <FieldContent>
        {props.controlId === undefined ? (
          <FieldTitle>{props.title}</FieldTitle>
        ) : (
          <FieldLabel htmlFor={props.controlId}>{props.title}</FieldLabel>
        )}
        {props.description === undefined ? null : <FieldDescription>{props.description}</FieldDescription>}
      </FieldContent>
      {props.children}
    </Field>
  )
}

function ChatSettings() {
  const platform = Platform.usePlatform()
  const id = useId()
  const [detail, setDetail] = useState(() => ChatPreferences.detail.read(platform.storage))
  const [followUp, setFollowUp] = useState(() => ChatPreferences.followUp.read(platform.storage))
  const [notify, setNotify] = useState(() => ChatPreferences.notify.read(platform.storage))
  return (
    <Page.Section title="Chats" frame="divided">
      <Setting title="Detail" description="How much of Ren’s work a chat shows." controlId={`${id}-detail`}>
        <Select
          items={detailOptions}
          value={detail}
          onValueChange={(next) => {
            if (next === null || next === detail) return
            ChatPreferences.detail.write(platform.storage, next)
            setDetail(next)
            void import("../../lib/chat.js").then((loaded) => loaded.Chat.forget())
          }}
        >
          <SelectTrigger id={`${id}-detail`} className="border-transparent text-muted-foreground">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {detailOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Setting>
      <Setting
        title="Messages sent while Ren works"
        description="Steering adds them to the current turn. Queued messages wait for it to finish."
        controlId={`${id}-follow-up`}
      >
        <Select
          items={followUpOptions}
          value={followUp}
          onValueChange={(next) => {
            if (next === null) return
            ChatPreferences.followUp.write(platform.storage, next)
            setFollowUp(next)
          }}
        >
          <SelectTrigger id={`${id}-follow-up`} className="border-transparent text-muted-foreground">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {followUpOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Setting>
      {platform.requestNotifications ? (
        <Setting
          title="Notify me when Ren finishes or needs input"
          description="Only while Ren’s tab is in the background."
          controlId={`${id}-notify`}
        >
          <Switch
            id={`${id}-notify`}
            checked={notify}
            onCheckedChange={(enabled) => {
              ChatPreferences.notify.write(platform.storage, enabled)
              setNotify(enabled)
              if (!enabled) return
              void platform.requestNotifications?.().then((allowed) => {
                if (!allowed)
                  toast.add({
                    type: "error",
                    title: "Notifications are blocked",
                    description: "Allow notifications for Ren in your browser’s site settings.",
                  })
              })
            }}
          />
        </Setting>
      ) : null}
    </Page.Section>
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
    <Page.Section title="Linked accounts" frame="divided">
      {offered.map((link) => (
        <LinkedAccount key={link.provider} link={link} />
      ))}
    </Page.Section>
  )
}

// oxlint-disable-next-line ren/no-comments -- access AC2: any member leaves; Better Auth refuses the last owner.
function LeaveOrganization(props: { organization: { id: string; name: string } }) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  return (
    <Page.Section title="Organization" frame="divided">
      <Setting
        title={props.organization.name}
        description="Leaving archives your private space and deletes your personal credentials here."
      >
        <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
          Leave organization
        </Button>
      </Setting>
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
        onConfirmed={() => toast.add({ type: "success", title: `You left ${props.organization.name}` })}
      />
    </Page.Section>
  )
}

function LinkedAccount(props: { link: ReturnType<typeof useAccountLink> }) {
  const link = props.link
  return (
    <Setting title={link.title} description={linkedDescriptions[link.provider][link.linked ? "linked" : "unlinked"]}>
      {link.linked ? (
        <Button variant="outline" size="sm" disabled={link.unlink.isPending} onClick={() => link.unlink.mutate()}>
          {link.unlink.isPending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
          Disconnect {link.title}
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={link.link.isPending || link.loading}
          onClick={() => link.link.mutate()}
        >
          {link.link.isPending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
          Connect {link.title}
        </Button>
      )}
    </Setting>
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
    <Page.Root title="Preferences">
      <Page.Section frame="divided">
        <Setting title="Email" description="Contact support to change.">
          <div className="min-w-0">
            <Text tone="secondary" wrapping="anywhere" element="span">
              {props.user.email}
            </Text>
          </div>
        </Setting>
        <Setting title="Name">
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
                toast.add({ type: "error", title: "Couldn’t update profile", description: message })
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
        </Setting>
      </Page.Section>
      <Page.Section title="Appearance" frame="divided">
        <Field>
          <FieldTitle>Theme</FieldTitle>
          <ThemeSelector value={theme.preference} onValueChange={theme.setPreference} />
        </Field>
      </Page.Section>
      <ChatSettings />
      <LinkedAccounts />
      {props.organization ? <LeaveOrganization organization={props.organization} /> : null}
      <Page.Section title="Security" frame="divided">
        <Setting title="Password">
          <Button variant="outline" size="xs" className="h-6.5" onClick={() => setChangingPassword(true)}>
            Change
          </Button>
        </Setting>
      </Page.Section>
      {changingPassword ? <PasswordDialog onClose={() => setChangingPassword(false)} /> : null}
    </Page.Root>
  )
}
