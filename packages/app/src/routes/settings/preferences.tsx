import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Switch } from "@/components/ui/switch"
import { EditableText } from "@/components/ren/editable-text"
import { Page, Row, Rows, Section } from "@/components/ren/page"
import { useMe } from "@/hooks/use-me"
import { api, errorMessage } from "@/lib/api"
import { auth } from "@/lib/auth"
import { askToNotify } from "@/lib/notify"
import { Choice, deliveries, details, PasswordDialog, ThemePicker } from "@/routes/settings/settings-shared"
import { chooseChatDetail, chooseFollowUp, chooseNotify, useChatDetail, useFollowUp, useNotify } from "@/stores/ui"

function usePreferencesPage() {
  const me = useMe()
  const queryClient = useQueryClient()
  const rename = useMutation({
    mutationFn: async (name: string) => {
      const result = await auth.updateUser({ name })
      if (result.error !== null) throw new Error(result.error.message ?? "Failed to change your name")
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: api.me.get.queryKey() }),
    onError: (error) => toast.error("Couldn’t change your name", { description: errorMessage(error) }),
  })
  return {
    user: me.user,
    detail: useChatDetail(),
    followUp: useFollowUp(),
    notify: useNotify(),
    rename: (name: string) => rename.mutateAsync(name),
    chooseDetail: (value: string) => chooseChatDetail(value === "detailed" ? "detailed" : "compact"),
    chooseFollowUp: (value: string) => chooseFollowUp(value === "queue" ? "queue" : "steer"),
    chooseNotify: (enabled: boolean) => {
      if (enabled) askToNotify()
      chooseNotify(enabled)
    },
  }
}

export function PreferencesPage() {
  const page = usePreferencesPage()
  return (
    <Page title="Preferences">
      <Rows>
        {[
          <Row key="email" title="Email" description="Contact support to change.">
            <span className="text-sm text-muted-foreground">{page.user.email}</span>
          </Row>,
          <Row key="name" title="Name">
            <EditableText value={page.user.name} label="name" required onCommit={page.rename} />
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
              <Choice label="Detail" options={details} value={page.detail} onChange={page.chooseDetail} />
            </Row>,
            <Row key="delivery" title="Messages sent while Ren works">
              <Choice
                label="Messages sent while Ren works"
                options={deliveries}
                value={page.followUp}
                onChange={page.chooseFollowUp}
              />
            </Row>,
            <Row
              key="notify"
              title="Notify me when Ren finishes or needs input"
              description="Only while Ren’s tab is in the background."
            >
              <Switch
                checked={page.notify}
                onCheckedChange={page.chooseNotify}
                aria-label="Notify me when Ren finishes or needs input"
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
    </Page>
  )
}
