import { ApplicationShell } from "@ren/ui/application-shell"
import { Avatar } from "@ren/ui/avatar"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import { Icon } from "@ren/ui/icon"
import { IconButton } from "@ren/ui/icon-button"
import { Menu } from "@ren/ui/menu"
import { Select } from "@ren/ui/select"
import { Text } from "@ren/ui/text"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { Auth } from "../../lib/auth.js"
import { Platform } from "../../platform/platform.js"
import { OrganizationSwitcher } from "./organization-switcher.js"

const founderCallURL = "https://calendly.com/shrey-renai/30min"
const docsURL = "https://useren.ai/docs"

export function ProfileCard(props: {
  user: { name: string; email: string; image?: string | null }
  organization: { id: string; name: string }
}) {
  const auth = Auth.useClient()
  const platform = Platform.usePlatform()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const navigation = ApplicationShell.useNavigation()
  const [loggingOut, setLoggingOut] = useState(false)
  const displayName = props.user.name || props.user.email || "User"
  return (
    <div className="flex items-center gap-1">
      <OrganizationSwitcher
        active={props.organization}
        onLogOut={() => setLoggingOut(true)}
        trigger={
          <Select.Button
            appearance="plain"
            size="large"
            width="fill"
            indicator={navigation.collapsed ? "none" : "chevron-up"}
            label={`Switch organization (current: ${props.organization.name})`}
            leading={<Avatar.Root name={displayName} image={props.user.image ?? undefined} size="large" decorative />}
          >
            {navigation.collapsed ? null : (
              <span className="flex min-w-0 flex-1 flex-col text-start">
                <Text element="span" truncation="single-line">
                  {displayName}
                </Text>
                <Text purpose="caption" element="span" truncation="single-line">
                  {props.organization.name}
                </Text>
              </span>
            )}
          </Select.Button>
        }
      />
      {navigation.collapsed ? null : (
        <div className="flex shrink-0 items-center">
          <Menu.Root>
            <Menu.Trigger
              render={
                <IconButton label="Help">
                  <Icon glyph="CircleHelp" />
                </IconButton>
              }
            />
            <Menu.Popup placement="top" alignment="end" width="small">
              <Menu.Item icon={<Icon glyph="Calendar" />} onSelect={() => platform.openExternal(founderCallURL)}>
                Talk to founder
              </Menu.Item>
              <Menu.Item icon={<Icon glyph="BookOpen" />} onSelect={() => platform.openExternal(docsURL)}>
                Documentation
              </Menu.Item>
            </Menu.Popup>
          </Menu.Root>
        </div>
      )}
      <ConfirmationDialog
        open={loggingOut}
        onOpenChange={setLoggingOut}
        title="Log out?"
        description="You’ll need to sign in again to access Ren."
        confirmLabel="Log out"
        onConfirm={async () => {
          await auth.signOut()
          queryClient.clear()
          await navigate({ to: "/login" })
        }}
      />
    </div>
  )
}
