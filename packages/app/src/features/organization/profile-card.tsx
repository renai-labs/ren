import { Avatar, AvatarFallback, AvatarImage } from "@ren/ui/avatar"
import { Button } from "@ren/ui/button"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Icon } from "@ren/ui/icon"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@ren/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { Initials } from "@ren/util/initials"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { Auth } from "../../lib/auth.js"
import { Links } from "../../lib/links.js"
import { Platform } from "../../platform/platform.js"
import { CreateOrganizationDialog } from "./create-organization-dialog.js"
import { OrganizationSwitcher } from "./organization-switcher.js"

export function ProfileCard(props: {
  user: { name: string; email: string; image?: string | null | undefined }
  organization: { id: string; name: string }
}) {
  const auth = Auth.useClient()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [loggingOut, setLoggingOut] = useState(false)
  const [creating, setCreating] = useState(false)
  const displayName = props.user.name || props.user.email || "User"
  return (
    <SidebarMenu>
      <SidebarMenuItem className="flex items-center gap-1">
        <OrganizationSwitcher
          active={props.organization}
          onCreate={() => setCreating(true)}
          onLogOut={() => setLoggingOut(true)}
          trigger={
            <SidebarMenuButton
              size="lg"
              className="h-10 min-w-0 flex-1 pl-3 group-data-[collapsible=icon]:pl-2"
              aria-label={`Switch organization (current: ${props.organization.name})`}
            >
              <Avatar aria-hidden className="group-data-[collapsible=icon]:size-6">
                {props.user.image ? <AvatarImage src={props.user.image} alt="" /> : null}
                <AvatarFallback>{Initials.of(displayName)}</AvatarFallback>
              </Avatar>
              <span className="flex min-w-0 flex-1 flex-col text-start leading-tight">
                <span className="truncate font-medium text-foreground">{displayName}</span>
                <span className="truncate text-xs">{props.organization.name}</span>
              </span>
              <Icon glyph="ChevronUp" />
            </SidebarMenuButton>
          }
        />
        <ProfileActions />
      </SidebarMenuItem>
      {creating ? <CreateOrganizationDialog onOpenChange={setCreating} /> : null}
      <ConfirmationDialog
        open={loggingOut}
        onOpenChange={setLoggingOut}
        title="Log out?"
        description="You’ll need to sign in again to access Ren."
        confirmLabel="Log out"
        onConfirm={async () => {
          await auth.signOut()
          queryClient.clear()
          await import("../../lib/chat.js").then((loaded) => loaded.Chat.forget())
          await navigate({ to: "/login" })
        }}
      />
    </SidebarMenu>
  )
}

function ProfileActions() {
  const platform = Platform.usePlatform()
  const navigate = useNavigate()
  const sidebar = useSidebar()
  return (
    <div className="flex shrink-0 items-center group-data-[collapsible=icon]:hidden">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Help" />}
        >
          <Icon glyph="CircleHelp" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => platform.openExternal(Links.founderCall)}>
              <Icon glyph="Calendar" />
              Talk to founder
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => platform.openExternal(Links.docs)}>
              <Icon glyph="BookOpen" />
              Documentation
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label="Settings"
              onClick={() => {
                sidebar.setOpenMobile(false)
                void navigate({ to: "/settings" })
              }}
            />
          }
        >
          <Icon glyph="Settings" />
        </TooltipTrigger>
        <TooltipContent>Settings</TooltipContent>
      </Tooltip>
    </div>
  )
}
