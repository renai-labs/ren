import { Button } from "@ren/ui/button"
import { Field } from "@ren/ui/field"
import { InlineEdit } from "@ren/ui/inline-edit"
import { PageShell } from "@ren/ui/page-shell"
import { Text } from "@ren/ui/text"
import { Theme } from "@ren/ui/theme"
import { ThemeSelector } from "@ren/ui/theme-selector"
import { Toast } from "@ren/ui/toast"
import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Auth } from "../../lib/auth.js"
import { RouterContext } from "../../lib/router-context.js"
import { PasswordDialog } from "./password-dialog.js"

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
