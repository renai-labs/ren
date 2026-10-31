import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "@ren/ui/sonner"
import { Button } from "@ren/ui/button"
import { Switch } from "@ren/ui/switch"
import { ConfirmDialog } from "../../components/confirm-dialog.js"
import { EditableText } from "../../components/editable-text.js"
import { Page, Row, Rows, Section } from "../../components/page.js"
import { useMe } from "../../lib/use-me.js"
import { errorMessage } from "../../lib/errors.js"
import { resetSession } from "../../lib/chat.js"
import { ChatPreferences } from "../../lib/chat-preferences.js"
import { Choice, deliveries, details, PasswordDialog, ThemePicker } from "../../components/settings-shared.js"
import { RouterContext } from "../../lib/router-context.js"

export function PreferencesPage() {
  const { api, auth, platform, queryClient } = RouterContext.useRouterContext()
  const me = useMe()
  const [detail, setDetail] = useState(() => ChatPreferences.detail.read(platform.storage))
  const [followUp, setFollowUp] = useState(() => ChatPreferences.followUp.read(platform.storage))
  const [notify, setNotify] = useState(() => ChatPreferences.notify.read(platform.storage))
  const rename = useMutation({
    mutationFn: async (name: string) => {
      const result = await auth.updateUser({ name })
      if (result.error !== null) throw new Error(result.error.message ?? "Failed to change your name")
    },
    // ast-grep-ignore: no-manual-invalidation -- Better Auth changes the user
    onSuccess: () => queryClient.invalidateQueries({ queryKey: api.me.get.queryKey() }),
    onError: (error) => toast.error("Couldn’t change your name", { description: errorMessage(error) }),
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
  const chooseDetail = (value: string) => {
    const next = value === "detailed" ? "detailed" : "compact"
    ChatPreferences.detail.write(platform.storage, next)
    setDetail(next)
  }
  const chooseFollowUp = (value: string) => {
    const next = value === "queue" ? "queue" : "steer"
    ChatPreferences.followUp.write(platform.storage, next)
    setFollowUp(next)
  }
  const chooseNotify = (enabled: boolean) => {
    if (enabled) void platform.requestNotifications?.()
    ChatPreferences.notify.write(platform.storage, enabled)
    setNotify(enabled)
  }
  return (
    <Page title="Preferences">
      <Rows>
        {[
          <Row key="email" title="Email" description="Contact support to change.">
            <span className="text-sm text-muted-foreground">{user.email}</span>
          </Row>,
          <Row key="name" title="Name">
            <EditableText
              value={user.name}
              label="name"
              required
              onCommit={(name: string) => rename.mutateAsync(name)}
            />
          </Row>,
        ]}
      </Rows>
      <Section title="Appearance">
        <Rows>{[<ThemePicker key="theme" />]}</Rows>
      </Section>
      <Section title="Chats">
        <Rows>
          {[
            <Row key="detail" title="Detail" description="How much of Ren’s work a chat shows.">
              <Choice label="Detail" options={details} value={detail} onChange={chooseDetail} />
            </Row>,
            <Row key="delivery" title="Messages sent while Ren works">
              <Choice
                label="Messages sent while Ren works"
                options={deliveries}
                value={followUp}
                onChange={chooseFollowUp}
              />
            </Row>,
            <Row
              key="notify"
              title="Notify me when Ren finishes or needs input"
              description="Only while Ren’s tab is in the background."
            >
              <Switch
                checked={notify}
                onCheckedChange={chooseNotify}
                aria-label="Notify me when Ren finishes or needs input"
              />
            </Row>,
          ]}
        </Rows>
      </Section>
      <Section title="Organization">
        <Rows>
          {[
            <Row
              key="leave"
              title={organization.name}
              description="Leaving archives your private space and deletes your personal credentials here."
            >
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
      <Section title="Security">
        <Rows>
          {[
            <Row key="password" title="Password">
              <PasswordDialog />
            </Row>,
          ]}
        </Rows>
      </Section>
    </Page>
  )
}
