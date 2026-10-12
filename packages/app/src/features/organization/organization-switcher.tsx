import { ApplicationShell } from "@ren/ui/application-shell"
import { Avatar } from "@ren/ui/avatar"
import { Button } from "@ren/ui/button"
import { Combobox } from "@ren/ui/combobox"
import { Icon } from "@ren/ui/icon"
import { Toast } from "@ren/ui/toast"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import type { ReactElement } from "react"
import { Auth } from "../../lib/auth.js"

export function OrganizationSwitcher(props: {
  trigger: ReactElement
  active: { id: string; name: string }
  onLogOut: () => void
}) {
  const auth = Auth.useClient()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const navigation = ApplicationShell.useNavigation()
  const [open, setOpen] = useState(false)
  const organizations = useQuery({ ...Auth.organizationsOptions(auth), enabled: open })
  const listed = organizations.data ?? []
  const items = [
    ...(listed.some((organization) => organization.id === props.active.id) ? [] : [props.active]),
    ...listed,
  ].map((organization) => ({
    value: organization.id,
    label: organization.name,
    icon: <Avatar.Root name={organization.name} size="small" decorative />,
  }))

  const switchTo = async (organizationId: string) => {
    navigation.dismiss()
    if (organizationId !== props.active.id) {
      const result = await auth.organization.setActive({ organizationId })
      if (result.error !== null) {
        Toast.manager.add({
          type: "error",
          title: "Couldn’t switch organization",
          description: result.error.message ?? undefined,
        })
        return
      }
      queryClient.clear()
    }
    await navigate({ to: "/" })
  }

  return (
    <Combobox.Popover
      trigger={props.trigger}
      open={open}
      onOpenChange={setOpen}
      width={navigation.collapsed ? "large" : "trigger"}
      label="Organizations"
      searchPlaceholder="Find organization"
      emptyMessage="No organizations"
      state={organizations.isError ? "failed" : "ready"}
      groups={[{ value: "organizations", label: "Organizations", items }]}
      value={props.active.id}
      onValueChange={(value) => {
        if (value !== null) void switchTo(value)
      }}
      footer={
        <Button
          appearance="ghost"
          size="small"
          width="full"
          alignment="start"
          leadingIcon={<Icon glyph="LogOut" />}
          onClick={() => {
            setOpen(false)
            props.onLogOut()
          }}
        >
          Log out
        </Button>
      }
    />
  )
}
